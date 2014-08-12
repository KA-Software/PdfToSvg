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
global.DOMParser = require('./domparsermock.js').DOMParserMock;

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

// Will be using promises to load document, pages and misc data instead of
// callback.

PDFJS.getDocument(data).then(function(pdf) {
  var numPages = pdf.numPages;
  // Using promise to fetch the page

  // For testing only.
  var MAX_NUM_PAGES = 50;
  var ii = Math.min(MAX_NUM_PAGES, numPages);
  
  var promise = Promise.resolve();
  for (var i = 1; i <= ii; i++) {
    /*var anchor = document.createElement('a');
    anchor.setAttribute('name', 'page=' + i);
    anchor.setAttribute('title', 'Page ' + i);
    document.body.appendChild(anchor);*/

    // Using promise to fetch and render the next page
    promise = promise.then(function (pageNum) {
      return pdf.getPage(pageNum).then(function (page) {
        var viewport = page.getViewport(1.5);

        /*var container = document.createElement('div');
        container.id = 'pageContainer' + pageNum;
        container.className = 'pageContainer';
        container.style.width = viewport.width + 'px';
        container.style.height = viewport.height + 'px';
        anchor.appendChild(container);*/

        /*var renderContext = {
          viewport: viewport,
          pageNum: pageNum,
          container: null
        };*/
        // the next page fetch will start only after this page rendering is done
        return page.getOperatorList().then(function (opList) {
          console.log(opList);
          /*var svgGfx = new SVGGraphics(page.commonObjs, page.objs);
          return svgGfx.loadDependencies(opList).then(function (values) {
            return svgGfx.beginDrawing(renderContext.viewport,
              renderContext.pageNum, renderContext.container, opList);
          });*/
        });
      });
    }.bind(null, i));
  }
});