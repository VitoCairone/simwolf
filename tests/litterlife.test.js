// A wolf litter's survival, at length: litter.test.js with its slow case too (a litter
// born at a den, with water 100 tiles off, lives to walk).
const { runStandalone } = require("./helpers");
const { run } = require("./litter.test");

async function main(browser, r) { await run(browser, r, true); }

module.exports = { name: "litter survival, to walking (wolves)", slow: true, main };
if (require.main === module) runStandalone(module.exports.name, main);
