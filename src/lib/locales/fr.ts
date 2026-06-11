/** Français (French). */
const fr: Record<string, string> = {
	// Étapes du flux de planification
	'stage.data': 'Données',
	'stage.align': 'Alignement',
	'stage.panoramic': 'Panoramique',
	'stage.nerve': 'Nerf',
	'stage.implants': 'Implants',
	'stage.sleeves': 'Douilles',
	'stage.guide': 'Guide',
	'stage.report': 'Rapport',

	// Barre d'outils DentalDB
	'db.title': 'DentalDB',
	'db.newPatient': 'Nouveau patient',
	'db.editPatient': 'Modifier le patient',
	'db.deletePatient': 'Supprimer le patient',
	'db.newCase': 'Nouveau cas',
	'db.openCase': 'Ouvrir le cas',
	'db.anonymize': 'Anonymiser',
	'db.exportCase': 'Exporter le cas',
	'db.importCase': 'Importer un cas',
	'db.patients': 'Patients',
	'db.cases': 'Cas',

	// Boutons et libellés courants
	'common.save': 'Enregistrer',
	'common.cancel': 'Annuler',
	'common.close': 'Fermer',
	'common.delete': 'Supprimer',
	'common.import': 'Importer',
	'common.export': 'Exporter',
	'common.print': 'Imprimer',
	'common.undo': 'Annuler la dernière action',
	'common.redo': 'Rétablir',
	'common.search': 'Rechercher',
	'common.ok': 'OK',
	'common.yes': 'Oui',
	'common.no': 'Non',
	'common.edit': 'Modifier',
	'common.new': 'Nouveau',
	'common.open': 'Ouvrir',
	'common.apply': 'Appliquer',
	'common.reset': 'Réinitialiser',
	'common.back': 'Retour',
	'common.next': 'Suivant',
	'common.done': 'Terminé',
	'common.loading': 'Chargement…',
	'common.error': 'Erreur',
	'common.warning': 'Avertissement',
	'common.settings': 'Paramètres',
	'common.help': 'Aide',
	'common.name': 'Nom',
	'common.date': 'Date',
	'common.status': 'Statut',
	'common.actions': 'Actions',
	'common.patient': 'Patient',
	'common.case': 'Cas',

	// Paramètres
	'settings.title': 'Paramètres',
	'settings.general': 'Général',
	'settings.appearance': 'Apparence',
	'settings.dicom': 'Import DICOM',
	'settings.users': 'Utilisateurs',
	'settings.audit': "Journal d'audit",
	'settings.backup': 'Sauvegarde',
	'settings.practice': 'Informations du cabinet',
	'settings.language': 'Langue',
	'settings.languageNote':
		"L'espace de planification adopte progressivement les textes traduits.",

	// Connexion / inscription
	'auth.signIn': 'Se connecter',
	'auth.signOut': 'Se déconnecter',
	'auth.email': 'E-mail',
	'auth.password': 'Mot de passe',
	'auth.confirmPassword': 'Confirmer le mot de passe',
	'auth.createAccount': 'Créer un compte',
	'auth.newHere': 'Nouveau ici ?',
	'auth.noAccounts': 'Aucun compte pour le moment — créez le premier :',
	'auth.mfaHint':
		"L'authentification à deux facteurs est activée — saisissez le code à 6 chiffres de votre application d'authentification.",
	'auth.mfaCode': "Code d'authentification",
	'auth.verify': 'Vérifier',
	'auth.startOver': 'Recommencer',
	'auth.register': "S'inscrire",

	// Titres de pages
	'page.inbox': 'Boîte de réception',
	'page.contacts': 'Contacts',
	'page.account': 'Compte',
	'page.orders': 'Commandes',
	'page.evaluation': 'Évaluation',
	'page.patients': 'Patients',

	// Page Compte
	'account.profile': 'Profil',
	'account.tier': 'Niveau',
	'account.credits': "Crédits d'export",
	'account.saveProfile': 'Enregistrer le profil',
	'account.changePassword': 'Changer le mot de passe',
	'account.currentPassword': 'Mot de passe actuel',
	'account.newPassword': 'Nouveau mot de passe (min. 8)',
	'account.buyCredits': 'Acheter 10 crédits',
	'account.creditsNote':
		"Chaque export d'un guide chirurgical pour la production consomme un crédit.",
	'account.remaining': 'Restant',
	'account.mfa': 'Authentification à deux facteurs (TOTP)',
	'account.usersTiers': 'Utilisateurs et niveaux',
	'account.saved': 'Enregistré',
	'account.language': 'Langue',

	// Outils de planification
	'plan.drawCurve': 'Tracer la courbe panoramique',
	'plan.addNerve': 'Ajouter un nerf',
	'plan.addImplant': 'Ajouter un implant',
	'plan.assignSleeves': 'Attribuer les douilles',
	'plan.generateGuide': 'Générer le guide',
	'plan.buildModel': 'Construire le modèle',
	'plan.measurements': 'Mesures',
	'plan.measureDistance': 'Mesurer une distance',
	'plan.measureAngle': 'Mesurer un angle',
	'plan.density': 'Densité osseuse',
	'plan.segmentation': 'Segmentation',
	'plan.crossSection': 'Coupe transversale',
	'plan.sleeveOffset': 'Décalage de douille',

	// Vues
	'viewer.axial': 'Axial',
	'viewer.coronal': 'Coronal',
	'viewer.sagittal': 'Sagittal',
	'viewer.3d': '3D',
	'viewer.sliceOf': 'Coupe {n} sur {total}',

	// Avertissements
	'warn.verifyNerve': 'Vérifiez manuellement le trajet du nerf',
	'warn.safetyDistance':
		"L'implant {label} est à {dist} mm du nerf — en dessous de la distance de sécurité de {min} mm.",
	'warn.sleeveCollision':
		'Collision de douilles détectée — ajustez les positions des implants ou les décalages des douilles.',
	'warn.unsaved': 'Vous avez des modifications non enregistrées.',

	// Titres de boîtes de dialogue
	'dialog.about': 'À propos de coDiagnostiX web',
	'dialog.onboarding': 'Bienvenue dans coDiagnostiX web',
	'dialog.printAll': 'Tout imprimer',
	'dialog.qrExport': 'Export QR',
	'dialog.confirmDelete': 'Confirmer la suppression',

	// Rapport
	'report.title': 'Rapport de planification chirurgicale'
};

export default fr;
