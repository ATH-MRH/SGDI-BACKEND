// Configuration Expo : celle de app.json, plus le fichier Firebase d'Android sans lequel aucun jeton de
// notification ne peut être obtenu. Ce fichier n'est jamais versionné (dépôt public) : EAS le fournit au
// build par la variable de type fichier GOOGLE_SERVICES_JSON (voir README, « Notifications push »).
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const result = googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
  if (process.env.IRON_EMPLOI_WEB === '1') {
    return { ...result, web: { ...result.web, output: 'single' }, experiments: { ...result.experiments, baseUrl: '/espace' } };
  }
  return result;
};
