/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

//
// See README for overview
//

'use strict';

//
// Fetch the PDF document from the URL using promises
//
PDFJS.getDocument('../../test/pdfs/my1.pdf').then(function(pdf) {
  var numPages = pdf.numPages;
  // Using promise to fetch the page

  var promise = Promise.resolve();
  for (var i = 1; i <= Math.min(50, numPages); i++) {
    // Using promise to fetch the page
    promise = promise.then(function (pageNum) {
      return pdf.getPage(pageNum).then(function (page) {
        var scale = 2.0;
        var viewport = page.getViewport(scale);

        var container = document.createElement('div');
        container.id = 'pageContainer' + pageNum;
        container.style.border = '1px solid black';
        document.body.appendChild(container);

        var renderContext = {
          viewport: viewport,
          pageNum: pageNum,
          container: container
        };
        // run rendering only when all pages are loaded
        promise.then(function () {
          page.renderSVG(renderContext);
        });
      });
    }.bind(null, i));
  }
});

