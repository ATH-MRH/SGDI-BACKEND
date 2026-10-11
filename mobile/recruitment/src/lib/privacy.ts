// Notice « Protection des données personnelles » affichée par l'application.
// Sa version doit être celle du serveur (PRIVACY_NOTICE_VERSION) : tout changement de fond change les deux,
// et le consentement est alors redemandé. Aucun import React Native ici : module testé par `npm test`.

export const PRIVACY_VERSION = '2026-10-11';
/** Marque les informations que seule la direction peut fournir : elles ne sont pas inventées. */
export const PENDING = 'À préciser par IRON GLOBAL avant la mise en service';
export const CONSENT_TEXT = 'J’accepte que mes données soient traitées par IRON GLOBAL SOLUTION pour la gestion de mes candidatures et du recrutement, comme l’explique la notice « Protection des données personnelles ».';

export type NoticeSection = { title: string; paragraphs?: string[]; points?: string[]; pending?: string[] };

export const PRIVACY_NOTICE: NoticeSection[] = [
  { title: 'Qui traite vos données',
    paragraphs: ['Le responsable du traitement est la SARL IRON GLOBAL SOLUTION, 76 Ahmed Sayeh, Les Sources, Bir Mourad Raïs. Contact : contact@irongs.com — +213 770 112 034.',
      'Déléguée à la protection des données : Narimane ZOUBIR — bdm@irongs.com — +213 770 112 034.',
      'Vos candidatures sont étudiées par le service recrutement de la société du groupe IRON GLOBAL qui publie l’annonce ou reçoit votre candidature.'] },
  { title: 'Cadre légal',
    paragraphs: ['Le traitement de vos données relève de la loi n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel, modifiée et complétée par la loi n° 25-11 du 24 juillet 2025.',
      'L’Autorité nationale de protection des données à caractère personnel (ANPDP) veille à l’application de cette loi. Cette application n’est ni agréée ni validée par l’ANPDP.',
      'La direction d’IRON GLOBAL SOLUTION déclare que la formalité accomplie auprès de l’ANPDP couvre les dossiers de recrutement.'],
    pending: ['Référence et date de la formalité accomplie auprès de l’ANPDP'] },
  { title: 'Pourquoi vos données sont utilisées',
    points: ['Créer et sécuriser votre espace candidat, identifié par votre numéro de téléphone.', 'Étudier vos candidatures à une annonce et vos candidatures spontanées.',
      'Échanger avec vous : messages, demandes de pièces, convocations et entretiens.', 'Préparer votre embauche si votre candidature est retenue : dossier, contrat, transmission à la direction des ressources humaines.',
      'Vous prévenir des nouvelles offres, uniquement si vous activez les alertes.'],
    paragraphs: ['Vos données ne servent pas à de la prospection commerciale et ne sont pas vendues.'] },
  { title: 'Données traitées',
    points: ['Identité : nom, prénom, date et lieu de naissance, sexe, situation familiale, nombre d’enfants, noms des parents, photo.',
      'Identifiants administratifs que vous choisissez de fournir : NIN, numéro CNAS.', 'Coordonnées : téléphone, e-mail, wilaya, commune, adresse, lien et téléphone de la personne à prévenir.',
      'Parcours : poste souhaité, salaire demandé, disponibilité, service militaire, expériences, formations, compétences, langues parlées et écrites.',
      'Informations utiles à la tenue de travail : taille, pointure, taille de chemise ; groupe sanguin si vous le renseignez.',
      'Documents : CV et pièces que vous transmettez.', 'Suivi : candidatures, messages, entretiens, notifications.',
      'Données techniques : session de connexion et, si vous activez les notifications du téléphone, l’identifiant de l’appareil.'],
    paragraphs: ['Seuls le nom, le prénom et le téléphone sont nécessaires pour créer l’espace. Les autres informations sont facultatives, sauf celles qu’une candidature exige.'] },
  { title: 'Qui y a accès',
    points: ['Le service recrutement et la direction des ressources humaines des sociétés du groupe concernées par votre candidature.', 'L’hébergeur OVHcloud : le serveur qui porte l’application et vos données est situé en France.',
      'Le prestataire de messagerie o2switch (France), pour les e-mails de convocation et les messages que vous adressez à contact@irongs.com.',
      'L’opérateur de téléphonie mobile, qui reçoit votre numéro pour vous remettre le code de vérification par SMS.'],
    paragraphs: ['Vos données sont hébergées hors d’Algérie. Les prestataires cités ci-dessous n’interviennent que pour le besoin du service.'],
    pending: ['Fondement du transfert de données hors d’Algérie'] },
  { title: 'Durée de conservation',
    paragraphs: ['Supprimer votre espace efface votre profil, votre CV, votre photo, vos alertes et vos notifications. Les candidatures déjà transmises, avec leurs pièces et leurs échanges, restent conservées par le service recrutement pour leur traitement.',
      'À l’issue des durées ci-dessous, fixées par la direction, les données sont supprimées par le service recrutement et la direction des ressources humaines.'],
    points: ['Candidature non retenue : 24 mois à compter du refus.', 'Espace candidat inactif : 24 mois après votre dernière activité.',
      'Dossier numérique d’une personne recrutée : 24 mois après son départ de l’entreprise.', 'Dossier papier d’une personne recrutée : 10 ans après son départ de l’entreprise.'] },
  { title: 'Vos droits',
    paragraphs: ['Vous disposez des droits prévus par la loi, notamment le droit d’être informé, le droit d’accès à vos données, le droit de les faire rectifier et le droit de vous opposer à leur traitement pour des motifs légitimes. Vous pouvez retirer votre consentement à tout moment.'],
    points: ['Dans l’application : modifier votre profil, retirer une candidature, supprimer votre espace (Profil → Paramètres).', 'Pour toute autre demande : écrivez à contact@irongs.com, à l’attention de Narimane ZOUBIR, déléguée à la protection des données.',
      'Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l’ANPDP.'] },
  { title: 'Consentement et notifications',
    paragraphs: ['Votre consentement porte sur le traitement de vos données pour le recrutement. Il est demandé une fois, enregistré avec sa date et la version de cette notice, et redemandé seulement si la notice change.',
      'Les notifications sont un réglage séparé : vous pouvez les activer ou les couper sans effet sur ce consentement, et inversement.'] },
];

/** Informations manquantes, toutes sections confondues : tant qu'il en reste, la notice n'est pas publiable. */
export const pendingItems = () => PRIVACY_NOTICE.flatMap(section => section.pending || []);
