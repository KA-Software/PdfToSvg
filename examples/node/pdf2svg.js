/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

//
// Basic node example that prints document metadata and text content.
// Requires single file built version of PDF.js -- please run
// `node make singlefile` before running the example.
//

var fs = require('fs');

// HACK few hacks to let PDF.js be loaded not as a module in global space.
global.window = global;
global.navigator = { userAgent: "node" };
global.PDFJS = {};

sheet = {
  cssRules: [],
  insertRule: function(rule, length) {
  },
};

style = {
  sheet: sheet,
};


function xmlEncode(s){
  var i = 0, ch;
  while (i < s.length && (ch = s[i]) !== '&' && ch !== '<' &&
         ch !== '\"' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
    i++;
  }
  if (i >= s.length) {
    return s;
  }
  var buf = s.substring(0, i);
  while (i < s.length) {
    ch = s[i++];
    switch (ch) {
      case '&':
        buf += '&amp;';
        break;
      case '<':
        buf += '&lt;';
        break;
      case '\"':
        buf += '&quot;';
        break;
      case '\n':
        buf += '&#xA;';
        break;
      case '\r':
        buf += '&#xD;';
        break;
      case '\t':
        buf += '&#x9;';
        break;
      default:
        buf += ch;
        break;
    }
  }
  return buf;
}


function DOMElement(name) {
  this.nodeName = name;
  this.childNodes = [];
  this.attributes = [];
  this.textContent = '';

  this.setAttributeNS = function setAttributeNS(NS, name, value) {
    value = value || '';
    value = xmlEncode(value);
    var attrString = [name, '"' + value + '"'].join('=');
    this.attributes.push(attrString);
  };

  this.appendChild = function appendChild(element) {
    var childNodes = this.childNodes;
    if (childNodes.indexOf(element) === -1) {
      childNodes.push(element);
    }
  };

  this.toString = function toString() {
    if (this.nodeName === 'svg:tspan') {
      this.textContent = xmlEncode(this.textContent);
      return '<' + this.nodeName + ' ' + this.attributes.join(' ') + '>'
               + this.textContent + '</' + this.nodeName + '>';
    } else if (this.nodeName === 'svg:svg') {
      this.attributes.push(['xmlns:svg="http://www.w3.org/2000/svg"',
       'xmlns:xlink="http://www.w3.org/1999/xlink"'].join(' '));

      return '<' + this.nodeName + ' ' + this.attributes.join(' ') + '>'
               + this.childNodes.join('') + '</' + this.nodeName + '>';
    } else {
      return '<' + this.nodeName + ' ' + this.attributes.join(' ') + '>'
               + this.childNodes.join('') + '</' + this.nodeName + '>';
    }
  };

  this.cloneNode = function cloneNode() {
    console.log(this);
    var newNode = new DOMElement(this.nodeName);
    newNode.childNodes = this.childNodes;
    newNode.attributes = this.attributes;
    newNode.textContent = this.textContent;
    return newNode;
  };
}

global.document = {
  childNodes : [],

  getElementById: function (id) {
    if (id === 'PDFJS_FONT_STYLE_TAG') {
      return style;
    }
  },

  createElementNS: function (NS, element) {
    console.log(element);
    var elObject = new DOMElement(element);
    return elObject;
  },
};

PDFJS.workerSrc = true;
require('../../build/singlefile/build/pdf.combined.js');

(function checkWindowBtoaCompatibility() {
  if ('btoa' in window) {
    return;
  }

  var digits =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  window.btoa = function windowBtoa(chars) {
    var buffer = '';
    var i, n;
    for (i = 0, n = chars.length; i < n; i += 3) {
      var b1 = chars.charCodeAt(i) & 0xFF;
      var b2 = chars.charCodeAt(i + 1) & 0xFF;
      var b3 = chars.charCodeAt(i + 2) & 0xFF;
      var d1 = b1 >> 2, d2 = ((b1 & 3) << 4) | (b2 >> 4);
      var d3 = i + 1 < n ? ((b2 & 0xF) << 2) | (b3 >> 6) : 64;
      var d4 = i + 2 < n ? (b3 & 0x3F) : 64;
      buffer += (digits.charAt(d1) + digits.charAt(d2) +
      digits.charAt(d3) + digits.charAt(d4));
  }
  return buffer;
};
})();

// Loading file from file system into typed array
var pdfPath = process.argv[2] || '../../web/compressed.tracemonkey-pldi-09.pdf';
var data = new Uint8Array(fs.readFileSync(pdfPath));

function writeToFile(svgdump, pageNum) {
  fs.mkdir("./svgdump/", function(err) {
    if (!err || err.code === 'EEXIST') {
      fs.writeFile("./svgdump/page" + pageNum + ".svg", svgdump,
        function(err) {
          if (err) {
            console.log("Error: " + err);
          } else {
            console.log("Page: " + pageNum);
          }
        });
    }
  });
}

// Will be using promises to load document, pages and misc data instead of
// callback.
PDFJS.getDocument(data).then(function (doc) {
  var numPages = doc.numPages;
  console.log('# Document Loaded');
  console.log('Number of Pages: ' + numPages);
  console.log();

  var lastPromise = Promise.resolve(); // will be used to chain promises
  var loadPage = function (pageNum) {
    return doc.getPage(pageNum).then(function (page) {
      console.log('# Page ' + pageNum);
      var viewport = page.getViewport(1.0 /* scale */);
      console.log('Size: ' + viewport.width + 'x' + viewport.height);
      console.log();

      var renderContext = {
        viewport: viewport,
        pageNum: pageNum,
        container: null
      };
      return page.getOperatorList().then(function (opList) {
        var svgGfx = new PDFJS.SVGGraphics(page.commonObjs, page.objs);
        return svgGfx.loadDependencies(opList).then(function (values) {
          var svgDump = svgGfx.dumpSVG(renderContext.viewport,
            renderContext.pageNum, renderContext.container, opList).toString();
          writeToFile(svgDump, pageNum);
          console.log(svgDump);
        });
      });
    })
  };
  // Loading of the first page will wait on metadata and subsequent loadings
  // will wait on the previous pages.
  for (var i = 1; i <= numPages; i++) {
    lastPromise = lastPromise.then(loadPage.bind(null, i));
  }
  return lastPromise;
}).then(function () {
  console.log('# End of Document');
}, function (err) {
  console.error('Error: ' + err);
});
