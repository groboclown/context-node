'use strict';
const common = require('../common');
const assert = require('assert');
const pathModule = require('path');

// const stackContext = require('context');
const security = require('security_context');
const toMatcher = security._toMatcher;

function normalizePath(p) {
  return pathModule.normalize(
    pathModule.toNamespacedPath(p)
  );
}

// --------------------------------------------------------------------
// Matcher tests
assert.strictEqual(
  toMatcher('abc')('abc'),
  true,
  'Matcher: simple string matches');
assert.strictEqual(
  toMatcher('abc')('def'),
  false,
  'Matcher: simple string mismatch');
assert.strictEqual(
  toMatcher('re:a.c')('abc'),
  true,
  'Matcher: string-as-regex match');
assert.strictEqual(
  toMatcher('re:a.c')('bc'),
  false,
  'Matcher: string-as-regex mismatch');
assert.strictEqual(
  toMatcher(/^a.+?c$/)('abc'),
  true,
  'Matcher: regex match');
assert.strictEqual(
  toMatcher(/^a.+?c$/)('babc'),
  false,
  'Matcher: regex mismatch');
assert.strictEqual(
  toMatcher(/\/must-exist\//)('/a/must-exist/b'),
  true,
  'Matcher: regex path match');
assert.strictEqual(
  toMatcher('/a/b/c')(normalizePath('/a/b/c')),
  true,
  'Matcher: strict path match');
assert.strictEqual(
  toMatcher('/a/b/c')(normalizePath('/a/b/cc')),
  false,
  'Matcher: strict path mismatch');
assert.strictEqual(
  toMatcher('/a/b/c/')(normalizePath('/a/b/c/d')),
  true,
  'Matcher: trailing /, strict path match');
assert.strictEqual(
  toMatcher('/a/b/c/')(normalizePath('/a/b/c')),
  false,
  'Matcher: trailing /, strict path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c/d')),
  true,
  'Matcher: trailing /, glob path match');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c')),
  false,
  'Matcher: trailing /, glob path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c/')),
  false,
  'Matcher: trailing / on both, glob path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/c')),
  true,
  'Matcher: glob 1 match');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b')),
  false,
  'Matcher: glob 1 subdir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/c/d')),
  false,
  'Matcher: glob 1 dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/c/d')),
  false,
  'Matcher: glob deep mismatch');
assert.strictEqual(
  toMatcher(['/a/b/*', 'c'])('c'),
  true,
  'Matcher: list match');
assert.strictEqual(
  toMatcher(['/a/b/*', 'cd'])('c'),
  false,
  'Matcher: list mismatch');
assert.strictEqual(
  toMatcher([])(normalizePath('c')),
  false,
  'Matcher: empty list mismatch');

// These are more testing the assumptions about normalizePath,
// which the code executes as input to the matcher.
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/../b/c')),
  true,
  'Matcher: glob redirect match');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/../c')),
  false,
  'Matcher: glob redirect mismatch');


// --------------------------------------------------------------------
// addFileAccessController Tests
const controllerGroup1 = security.addFileAccessController({});
assert.ok(
  controllerGroup1,
  'addFileAccessController did not create a new object');
assert.ok(
  controllerGroup1[security.FILE_ACCESS],
  'addFileAccessController did not create a FILE_ACCESS controller');
assert.ok(
  controllerGroup1[security.FILE_ACCESS] instanceof
    security.FileAccessController,
  'addFileAccessController did not create a FileAccessController controller');

const controllerGroup2 = { 'a': 2 };
const controllerGroupRet = security.addFileAccessController(
  controllerGroup2, {});
assert.ok(
  controllerGroupRet,
  'addFileAccessController did not return an object');
assert.ok(
  controllerGroup2[security.FILE_ACCESS],
  'addFileAccessController did not add FILE_ACCESS');
assert.ok(
  controllerGroup2[security.FILE_ACCESS] instanceof
    security.FileAccessController,
  'addFileAccessController did not add a FileAccessController controller');
assert.strictEqual(
  controllerGroup2.a,
  2,
  'addFileAccessController did not maintain the original object values');
assert.strictEqual(
  controllerGroupRet.a,
  2,
  'addFileAccessController did not return the original object');


// --------------------------------------------------------------------
// Check the implementation of the security.

// try with undefined options
new security.FileAccessController();

// try with null options
new security.FileAccessController(null);

// try with no options
new security.FileAccessController({});
