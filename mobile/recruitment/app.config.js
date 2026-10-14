// Configuration Expo : celle de app.json, plus le fichier Firebase d'Android sans lequel aucun jeton de
// notification ne peut être obtenu. Ce fichier n'est jamais versionné (dépôt public) : EAS le fournit au
// build par la variable de type fichier GOOGLE_SERVICES_JSON (voir README, « Notifications push »).
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  return googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
};
