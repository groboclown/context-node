'use strict';
const common = require('../common');
//const assert = require('assert');
const fs = require('fs');

const stackContext = require('context');
const security = require('security_context');

function fsSecurityTest(name, setup, fn) {
  const controllerId = stackContext.getCurrentContext().pushControllers(
    security.addFileAccessController({
      [security.FILE_ACCESS]: setup
    })
  );
  try {
    fn();
  } catch (e) {
    console.log('Failed `' + name + '`: ' + e);
    console.log(e.stack);
    throw e;
  } finally {
    stackContext.getCurrentContext().popControllers(controllerId);
  }
}

/*
fsSecurityTest(
  'file access control wrapper check - single object', {},
  () => {
    common.expectsError(
      () => {
        stackContext.wrapFunction({ readable: {} }, () => {})();
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be of type string | ' +
          'RegExp | array of string or RegExp. Received type object'
      }
    );
  });

fsSecurityTest(
  'file access control wrapper check - array of object', {},
  () => {
    common.expectsError(
      () => {
        stackContext.wrapFunction({ readable: [{}] }, () => {})();
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be of type string | ' +
          'RegExp | array of string or RegExp. Received type object'
      }
    );
  });
*/

fsSecurityTest(
  'fs.open for read: allowed',
  { readable: common.tmpDir },
  () => {
    const a = fs.open(common.tmpDir + '/a.tmp', 'r');
    fs.close(a);
  });

fsSecurityTest(
  'fs.open for write: allowed',
  { writable: common.tmpDir },
  () => {
    const a = fs.open(common.tmpDir + '/a.tmp', 'w');
    fs.close(a);
  });


fsSecurityTest(
  'fs.open for read: not allowed',
  { readable: [] },
  () => {
    common.expectsError(
      () => {
        const a = fs.open(common.tmpDir + '/a.tmp', 'r');
        // in case it passes.
        fs.close(a);
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: 'asdf'
      });
  });

fsSecurityTest(
  'fs.open for write: not allowed',
  { writable: [] },
  () => {
    common.expectsError(
      () => {
        const a = fs.open(common.tmpDir + '/a.tmp', 'w');
        // in case it passes.
        fs.close(a);
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: 'asdf'
      });
  });
