// Source métier complète pour les assertions statiques historiques.
// Ne simule pas le bootstrap : module-campaign.test.js vérifie les scripts lazy.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function readClientSource() {
  const root = path.join(__dirname, '../app/static');
  return fs.readFileSync(path.join(root, 'js/core/files.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'sgdi-app.js'), 'utf8') + '\n' +
    fs.readdirSync(path.join(root, 'js/modules')).filter(f => f.endsWith('.js')).sort()
      .map(f => fs.readFileSync(path.join(root, 'js/modules', f), 'utf8')).join('\n');
};
