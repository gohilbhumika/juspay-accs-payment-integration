/*
 * Workaround for an Admin UI SDK V2 / Parcel build issue: the extension's
 * .tsx files compile to calls against react/jsx-dev-runtime's `jsxDEV`, but
 * Parcel inlines process.env.NODE_ENV as "production" project-wide, which
 * dead-code-eliminates the real (env-guarded) implementation in
 * react/cjs/react-jsx-dev-runtime.development.js - leaving `jsxDEV`
 * undefined at runtime ("jsxDEV is not a function").
 *
 * This shim has no NODE_ENV branch to strip: it forwards jsxDEV straight to
 * react/jsx-runtime's real (ungated) production jsx/jsxs, ignoring the
 * extra dev-only debug args (source/self/__DEV__ key warnings).
 * Aliased in package.json's "alias" field.
 */
const { Fragment, jsx, jsxs } = require("react/jsx-runtime");

exports.Fragment = Fragment;

exports.jsxDEV = function jsxDEV(type, props, key, isStaticChildren) {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
};
