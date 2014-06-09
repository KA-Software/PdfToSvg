/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* globals ColorSpace, DeviceCmykCS, DeviceGrayCS, DeviceRgbCS, error, PDFJS,
           FONT_IDENTITY_MATRIX, Uint32ArrayView, IDENTITY_MATRIX, ImageData,
           ImageKind, isArray, isNum, TilingPattern, OPS, Promise, Util, warn,
           assert, info, shadow, TextRenderingMode, getShadingPatternFromIR,
           WebGLUtils */

'use strict';

function createScratchSVG(width, height) {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, 'svg:svg');
  svg.setAttributeNS(null, "version", "1.1");
  svg.setAttributeNS(null, "width", width + 'px');
  svg.setAttributeNS(null, "height", height + 'px');
  svg.setAttributeNS(null, "viewBox", "0 " + (-height) + " " + width + " " + height);
  return svg;
}

var SVGExtraState = (function SVGExtraStateClosure() {
  function SVGExtraState(old) {
    // Are soft masks and alpha values shapes or opacities?
    this.fontSize = 0;
    this.fontSizeScale = 1;
    this.textMatrix = IDENTITY_MATRIX;
    this.fontMatrix = FONT_IDENTITY_MATRIX;
    this.leading = 0;
    // Current point (in user coordinates)
    this.x = 0;
    this.y = 0;
    // Start of text line (in text coordinates)
    this.lineX = 0;
    this.lineY = 0;
    // Character and word spacing
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.textHScale = 1;
    this.textRenderingMode = TextRenderingMode.FILL;
    this.textRise = 0;
    // Default fore and background colors
    this.fillColor = '#000000';
    this.strokeColor = '#000000';

    // Dependency
    this.dependencies = [];
    this.count = 0;
  }

  SVGExtraState.prototype = {
    clone: function SVGExtraState_clone() {
      return Object.create(this);
    },
    setCurrentPoint: function SVGExtraState_setCurrentPoint(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  return SVGExtraState;
})();

function opListToTree(opList) {

  var opTree = [];
  var saveIdx = [];
  var restIdx = [];
  var tmp = [];
  var items = [];

  for (var x = 0; x < opList.length; x++) {
    if (opList[x].fn == 'save') {
      opTree.push({'fnId': 92, 'fn': 'group', 'items': []});
      tmp.push(opTree);
      opTree = opTree[opTree.length - 1].items;
      continue;
    }

    if(opList[x].fn == 'restore') {
      opTree = tmp.pop();
    }
    else {
      opTree.push(opList[x]);
    }
  }
  return opTree;
}


var SVGGraphics = (function SVGGraphicsClosure(ctx) {
  function SVGGraphics(commonObjs) {

    this.current = new SVGExtraState();
    this.transformMatrix = IDENTITY_MATRIX; // Graphics state matrix
    this.transformStack = [];
    this.extraStack = [];
    this.commonObjs = commonObjs;

  }

  SVGGraphics.prototype = {

    save: function SVGGraphics_save() {
      this.transformStack.push(this.transformMatrix);
      this.extraStack.push(this.current);
    },

    
    restore: function SVGGraphics_restore() {
      this.transformMatrix = this.transformStack.pop();
      this.current = this.extraStack.pop();
    },

    group: function SVGGraphics_group(items) {
      this.save();
      this.executeOpTree(items);
      this.restore();
    },

    transform: function SVGGraphics_transform(a, b, c, d, e, f) {
      var transformMatrix = [a, b, c, d, e, -f];
      this.transformMatrix = PDFJS.Util.transform(this.transformMatrix, transformMatrix);

      this.ctx = document.createElementNS(this.NS, 'svg:g')
      this.ctx.setAttributeNS(null, 'id', 'transform');
      this.ctx.setAttributeNS(null, 'transform', 'matrix(' + this.transformMatrix + ')');
      this.svg.appendChild(this.ctx);
    },

    setWordSpacing: function SVGGraphics_setWordSpacing(wordSpacing) {
      this.current.wordSpacing = wordSpacing;
    },

    setCharSpacing: function SVGGraphics_setCharSpacing(charSpacing) {
      this.current.charSpacing = charSpacing;
    },

    setTextMatrix: function SVGGraphics_setTextMatrix(a, b, c, d, e, f) {
      var current = this.current;
      this.current.textMatrix = [a, -b, -c, d, e, -f];
      this.current.lineMatrix = [a, -b, -c, d, e, -f];

      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;

      current.xcoords = [];
      current.tspan = document.createElementNS(this.NS, 'svg:tspan');
      current.tspan.setAttributeNS(null, 'font-family', current.fontFamily);
      current.tspan.setAttributeNS(null, 'font-size', current.fontSize);
      current.tspan.setAttributeNS(null, 'y', -current.y);
      current.xcoords.push(current.x);

      current.txtElement = document.createElementNS(this.NS, 'svg:text');
      current.txtElement.appendChild(current.tspan);

    },

    nextLine: function SVGGraphics_nextLine() {
      this.moveText(0, this.current.leading);
    },

    beginDrawing: function SVGGraphics_beginDrawing(viewport) {
      console.log("begin drawing svg")
      this.svg = createScratchSVG(viewport.width, viewport.height);
      this.NS = "http://www.w3.org/2000/svg";
      this.container = document.getElementById('pageContainer');
      this.viewport = viewport;
      this.transformMatrix = IDENTITY_MATRIX;
      this.ctx = document.createElementNS(this.NS, 'svg:g');
      this.svg.appendChild(this.ctx);
      this.container.appendChild(this.svg);
    },

    convertOpList: function SVGGraphics_convertOpList(operatorList) {
      var argsArray = operatorList.argsArray;
      var fnArray = operatorList.fnArray;
      var fnArrayLen  = fnArray.length;
      var argsArrayLen = argsArray.length;
      var opTree = [];

      var REVOPS = OPS;

      for (var op in REVOPS) {
        REVOPS[REVOPS[op]] = op;
      }

      var opList = [];

      for (var x = 0; x < fnArrayLen; x++) {
        var fnId = fnArray[x];
        opList.push({'fnId' : fnId, 'fn': REVOPS[fnId], 'args': argsArray[x]});
      }

      opTree = opListToTree(opList);

      //console.log(opTree);
      window.prompt('', JSON.stringify(opTree));
      this.executeOpTree(opTree);

    },
    
    executeOpTree: function SVGGraphics_executeOpTree(opTree) {
      var opTreeLen = opTree.length;

      for(var x =0; x < opTreeLen; x++) {
        var fn = opTree[x].fn;
        var fnId = opTree[x].fnId;
        var args = opTree[x].args;
        //console.log(fn, args);

        switch (fnId | 0) {

          case OPS.beginText:
            this.beginText(args);
            break;
          case OPS.setLeading:
            this.setLeading(args);
            break;
          case OPS.setLeadingMoveText:
            this.setLeadingMoveText(args[0], args[1]);
            break
          case OPS.setFont:
            this.setFont(args);
            break;
          case OPS.showText:
          this.showText(args[0]);
            break;
          case OPS.showSpacedText:
            this.showText(args[0]);
            break;
          case OPS.endText:
            this.endText(args);
            break;
          case OPS.moveText:
            this.moveText(args[0], args[1]);
            break;
          case OPS.setCharSpacing:
            this.setCharSpacing(args[0]);
            break
          case OPS.setWordSpacing:
            this.setWordSpacing(args[0]);
            break;
          case OPS.setTextMatrix:
            this.setTextMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
            break;
          case OPS.nextLine:
            this.nextLine();
            break;
          case OPS.transform:
            this.transform(args[0], args[1], args[2], args[3], args[4], args[5]);
            break;
          case OPS.constructPath:
            this.constructPath(args[0], args[1]);
            break;
          case OPS.rectangle:
            this.rectangle(args[0], args[1], args[2], args[3]);
            break;
          case 92:
            this.group(opTree[x].items);
            break;
          default:
            console.log(fn)
            //console.error('Unimplemented Method');
        }
      }
    },

    loadDependencies: function SVGGraphics_loadDependencies(operatorList) {
      //var fnArray = operatorList.fnArray;
      console.log(operatorList);
      var fnArray = operatorList.fnArray;
      var fnArrayLen = fnArray.length;
      var argsArray = operatorList.argsArray;

      var self = this;
      for (var i = 0; i < fnArrayLen; i++) {
        if (OPS.dependency == fnArray[i]) {
          var deps = argsArray[i];
          //console.log(deps);
          for (var n = 0, nn = deps.length; n < nn; n++) {
            var obj = deps[n];
            var common = obj.substring(0, 2) == 'g_';
            if (common) {
              var promise = new Promise(function(resolve) {
                self.commonObjs.get(obj, resolve);
              });
            }
          }
        }
        this.current.dependencies.push(promise);
      }
      Promise.all(this.current.dependencies).then(function(values) {
        console.log('All dependencies resolved')
        self.convertOpList(operatorList);
      });
    },

    constructPath: function SVGGraphics_constructPath(ops, args) {
      var current = this.current;
      var x = current.x, y = current.y;
      var path = document.createElementNS(this.NS, 'svg:path');
      var d = '';

      for (var i = 0, j = 0, ii = ops.length; i < ii; i++) {
        switch (ops[i] | 0) {
          case OPS.moveTo:
            x = args[j++];
            y = args[j++];
            d += 'M' + x + ' ' + y;
            break;
          case OPS.lineTo:
            x = args[j++];
            y = args[j++];
            d += 'L' + x + ' ' + y;
            break;
          case OPS.curveTo:
            x = args[j + 4];
            y = args[j + 5];
            var arr = [args[j], args[j + 1], args[j + 2], args[j + 3], x, y]
            d += 'C ' + arr.join(' ');
            j += 6;
            break;
          case OPS.curveTo2:
            x = args[j + 2];
            y = args[j + 3];
            var arr = [x, y, args[j], args[j + 1], args[j + 2], args[j + 3]];
            d += 'C ' + arr.join(' ');
            j += 4;
            break;
          case OPS.curveTo3:
            x = args[j + 2];
            y = args[j + 3];
            var arr = [args[j], args[j + 1], x, y, x, y];
            d += 'C ' + arr.join(' ');
            j += 4;
            break;
          case OPS.closePath:
            d += 'Z';
            break;
        }
      }
      path.setAttributeNS(null, 'd', d);
      path.setAttributeNS(null, 'stroke', 'black');
      path.setAttributeNS(null, 'stroke-width', '2');
      path.setAttributeNS(null, 'fill', 'none');
      path.setAttributeNS(null, 'transform', 'scale(2, -2)')
      this.ctx.appendChild(path);
      current.setCurrentPoint(x, y);
    },

    beginText: function SVGGraphics_beginText(args) {
      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
      this.current.textMatrix = IDENTITY_MATRIX;
      this.current.lineMatrix = IDENTITY_MATRIX;
      this.current.tspan = document.createElementNS(this.NS, 'svg:tspan');
      this.current.txtElement = document.createElementNS(this.NS, 'svg:text');
      this.current.txtgrp = document.createElementNS(this.NS, 'svg:g');
      this.current.xcoords = [];
    },

    setLeading: function SVGGraphics_setLeading(leading) {
      this.current.leading = -leading;
    },

    setTextRise: function SVGGraphics_setTextRise(textRise) {
      this.current.textRise = textRise;
    },

    rectangle: function SVGGraphics_rectangle(x, y, width, height) {
      /*var rect = document.createElementNS(this.NS, 'svg:rect');
      rect.setAttributeNS(null, 'x', x);
      rect.setAttributeNS(null, 'y', y);
      rect.setAttributeNS(null, 'width', width);
      rect.setAttributeNS(null, 'height', height);
      rect.setAttributeNS(null, 'fill', 'none');
      rect.setAttributeNS(null, 'stroke', 'black');
      rect.setAttributeNS(null, 'transform', 'scale(2, -2)');
      this.ctx.appendChild(rect);*/
    },

    moveText: function SVGGraphics_moveText(x, y) {
      var current = this.current;
      this.current.x = this.current.lineX += x;
      this.current.y = this.current.lineY += y;

      current.xcoords = [];
      current.tspan = document.createElementNS(this.NS, 'svg:tspan');
      current.tspan.setAttributeNS(null, 'font-family', current.fontFamily);
      current.tspan.setAttributeNS(null, 'font-size', current.fontSize);
      current.tspan.setAttributeNS(null, 'y', -current.y);
      current.xcoords.push(current.x);
    },

    showText: function CanvasGraphics_showText(glyphs) {
      var current = this.current;
      var font = current.font;
      if (font.isType3Font) {
        return this.showType3Text(glyphs);
      }

      var fontSize = current.fontSize;
      if (fontSize === 0) {
        return;
      }

      var fontSizeScale = current.fontSizeScale;
      var charSpacing = current.charSpacing;
      var wordSpacing = current.wordSpacing;
      var fontDirection = current.fontDirection;
      var textHScale = current.textHScale * fontDirection;
      var glyphsLength = glyphs.length;
      var vertical = font.vertical;
      var defaultVMetrics = font.defaultVMetrics;
      var widthAdvanceScale = fontSize * current.fontMatrix[0];

      var simpleFillText =
        current.textRenderingMode === TextRenderingMode.FILL &&
        !font.disableFontFace;


      if (fontDirection > 0) {
        //ctx.scale(textHScale, -1);
      } else {
        //ctx.scale(textHScale, 1);
      }

      /*var lineWidth = current.lineWidth;
      var scale = current.textMatrixScale;
      if (scale === 0 || lineWidth === 0) {
        lineWidth = this.getSinglePixelWidth();
      } else {
        lineWidth /= scale;
      }*/

      if (fontSizeScale != 1.0) {
        ctx.scale(fontSizeScale, fontSizeScale);
        lineWidth /= fontSizeScale;
      }

      //ctx.lineWidth = lineWidth;

      var x = 0, i;
      for (i = 0; i < glyphsLength; ++i) {
        var glyph = glyphs[i];
        if (glyph === null) {
          // word break
          x += fontDirection * wordSpacing;
          current.xcoords.push(current.x + x * textHScale);
          current.tspan.textContent += " ";
          continue;
        } else if (isNum(glyph)) {
          x += -glyph * fontSize * 0.001;
          current.xcoords.push(current.x + x * textHScale);
          current.tspan.textContent +=  " ";
          continue;
        }

        var restoreNeeded = false;
        var character = glyph.fontChar;
        var accent = glyph.accent;
        var scaledX, scaledY, scaledAccentX, scaledAccentY;
        var width = glyph.width;
        if (vertical) {
          var vmetric, vx, vy;
          vmetric = glyph.vmetric || defaultVMetrics;
          vx = glyph.vmetric ? vmetric[1] : width * 0.5;
          vx = -vx * widthAdvanceScale;
          vy = vmetric[2] * widthAdvanceScale;

          width = vmetric ? -vmetric[0] : width;
          scaledX = vx / fontSizeScale;
          scaledY = (x + vy) / fontSizeScale;
        } else {
          scaledX = x / fontSizeScale;
          scaledY = 0;
        }

        /*if (font.remeasure && width > 0 && this.isFontSubpixelAAEnabled) {
          // some standard fonts may not have the exact width, trying to
          // rescale per character
          var measuredWidth = ctx.measureText(character).width * 1000 /
            fontSize * fontSizeScale;
          var characterScaleX = width / measuredWidth;
          restoreNeeded = true;
          ctx.save();
          ctx.scale(characterScaleX, 1);
          scaledX /= characterScaleX;
        }*/

        /*if (simpleFillText && !accent) {
          // common case
          ctx.fillText(character, scaledX, scaledY);
        } else {
          this.paintChar(character, scaledX, scaledY);
          if (accent) {
            scaledAccentX = scaledX + accent.offset.x / fontSizeScale;
            scaledAccentY = scaledY - accent.offset.y / fontSizeScale;
            this.paintChar(accent.fontChar, scaledAccentX, scaledAccentY);
          }
        }*/

        var charWidth = width * widthAdvanceScale + charSpacing * fontDirection;
        x += charWidth;
        current.xcoords.push(current.x + x * textHScale);

        if (restoreNeeded) {
          //ctx.restore();
        }
        current.tspan.textContent += character;
      }
      if (vertical) {
        current.y -= x * textHScale;
      } else {
        current.x += x * textHScale;
      }

      // ctx.restore();

      current.tspan.setAttributeNS(null, 'x', current.xcoords.join(" "));
      current.tspan.setAttributeNS(null, 'font-family', current.fontFamily);
      current.tspan.setAttributeNS(null, 'font-size', current.fontSize);

      current.txtElement.setAttributeNS(null, 'transform', 'scale(1, -1) matrix(' + current.textMatrix + ')' );
      current.txtElement.setAttributeNS("http://www.w3.org/XML/1998/namespace", 'xml:space', 'preserve');
      current.txtElement.appendChild(current.tspan);

      current.txtgrp.setAttributeNS(null, 'id', 'text');
      current.txtgrp.setAttributeNS(null, 'transform', 'scale(2, -2)');
      current.txtgrp.appendChild(current.txtElement);

      //current.grp.setAttributeNS(null, 'transform', 'scale(2, -2)');
      //current.grp.appendChild(current.txtgrp);
      this.ctx.appendChild(current.txtgrp);


    },

    setLeadingMoveText: function SVGGraphics_setLeadingMoveText(x, y) {
      this.setLeading(-y);
      this.moveText(x, y);
    },

    setFont: function SVGGraphics_setFont(details) {
      var current = this.current;
      var fontObj = this.commonObjs.get(details[0]);
      var size = details[1];
      this.current.font = fontObj;

      current.fontMatrix = (fontObj.fontMatrix ?
                           fontObj.fontMatrix : FONT_IDENTITY_MATRIX);

      var bold = fontObj.black ? (fontObj.bold ? 'bolder' : 'bold') :
                                 (fontObj.bold ? 'bold' : 'normal');

      var italic = fontObj.italic ? 'italic' : 'normal';

      current.font.style = (bold == 'normal' ? (italic == 'normal' ? '' : 'font-weight:' + italic) :
                                                   'font-weight:' + bold);

      if (size < 0) {
        size = -size;
        current.fontDirection = -1;
      } else {
        current.fontDirection = 1;
      }
      current.fontSize = size;
      current.fontFamily = fontObj.loadedName;
    },

    endText: function SVGGraphics_endText(args) {
      //console.log(this.current.count);
      //console.log(this.current.xcoords.length)
    }

  }

  return SVGGraphics;
})();
