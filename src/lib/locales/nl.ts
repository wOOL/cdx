/** Nederlands (Dutch). */
const nl: Record<string, string> = {
	// Fasen van de planningsworkflow
	'stage.data': 'Gegevens',
	'stage.align': 'Uitlijnen',
	'stage.panoramic': 'Panorama',
	'stage.nerve': 'Zenuw',
	'stage.implants': 'Implantaten',
	'stage.sleeves': 'Hulzen',
	'stage.guide': 'Boormal',
	'stage.report': 'Rapport',

	// DentalDB-werkbalk
	'db.title': 'DentalDB',
	'db.newPatient': 'Nieuwe patiënt',
	'db.editPatient': 'Patiënt bewerken',
	'db.deletePatient': 'Patiënt verwijderen',
	'db.newCase': 'Nieuwe casus',
	'db.openCase': 'Casus openen',
	'db.anonymize': 'Anonimiseren',
	'db.exportCase': 'Casus exporteren',
	'db.importCase': 'Casus importeren',
	'db.patients': 'Patiënten',
	'db.cases': 'Casussen',

	// Algemene knoppen en labels
	'common.save': 'Opslaan',
	'common.cancel': 'Annuleren',
	'common.close': 'Sluiten',
	'common.delete': 'Verwijderen',
	'common.import': 'Importeren',
	'common.export': 'Exporteren',
	'common.print': 'Afdrukken',
	'common.undo': 'Ongedaan maken',
	'common.redo': 'Opnieuw uitvoeren',
	'common.search': 'Zoeken',
	'common.ok': 'OK',
	'common.yes': 'Ja',
	'common.no': 'Nee',
	'common.edit': 'Bewerken',
	'common.new': 'Nieuw',
	'common.open': 'Openen',
	'common.apply': 'Toepassen',
	'common.reset': 'Herstellen',
	'common.back': 'Terug',
	'common.next': 'Volgende',
	'common.done': 'Gereed',
	'common.loading': 'Laden…',
	'common.error': 'Fout',
	'common.warning': 'Waarschuwing',
	'common.settings': 'Instellingen',
	'common.help': 'Help',
	'common.name': 'Naam',
	'common.date': 'Datum',
	'common.status': 'Status',
	'common.actions': 'Acties',
	'common.patient': 'Patiënt',
	'common.case': 'Casus',

	// Instellingen
	'settings.title': 'Instellingen',
	'settings.general': 'Algemeen',
	'settings.appearance': 'Weergave',
	'settings.dicom': 'DICOM-import',
	'settings.users': 'Gebruikers',
	'settings.audit': 'Auditlogboek',
	'settings.backup': 'Back-up',
	'settings.practice': 'Praktijkgegevens',
	'settings.language': 'Taal',
	'settings.languageNote': 'De planningsomgeving neemt vertaalde teksten stapsgewijs over.',

	// Inloggen / registreren
	'auth.signIn': 'Inloggen',
	'auth.signOut': 'Uitloggen',
	'auth.email': 'E-mail',
	'auth.password': 'Wachtwoord',
	'auth.confirmPassword': 'Wachtwoord bevestigen',
	'auth.createAccount': 'Account aanmaken',
	'auth.newHere': 'Nieuw hier?',
	'auth.noAccounts': 'Nog geen accounts — maak het eerste aan:',
	'auth.mfaHint':
		'Tweefactorauthenticatie is ingeschakeld — voer de 6-cijferige code uit uw authenticator-app in.',
	'auth.mfaCode': 'Authenticatorcode',
	'auth.verify': 'Verifiëren',
	'auth.startOver': 'Opnieuw beginnen',
	'auth.register': 'Registreren',

	// Paginatitels
	'page.inbox': 'Postvak IN',
	'page.contacts': 'Contacten',
	'page.account': 'Account',
	'page.orders': 'Bestellingen',
	'page.evaluation': 'Evaluatie',
	'page.patients': 'Patiënten',

	// Accountpagina
	'account.profile': 'Profiel',
	'account.tier': 'Niveau',
	'account.credits': 'Exportcredits',
	'account.saveProfile': 'Profiel opslaan',
	'account.changePassword': 'Wachtwoord wijzigen',
	'account.currentPassword': 'Huidig wachtwoord',
	'account.newPassword': 'Nieuw wachtwoord (min. 8)',
	'account.buyCredits': '10 credits kopen',
	'account.creditsNote': 'Elke export van een boormal voor productie verbruikt één credit.',
	'account.remaining': 'Resterend',
	'account.mfa': 'Tweefactorauthenticatie (TOTP)',
	'account.usersTiers': 'Gebruikers & niveaus',
	'account.saved': 'Opgeslagen',
	'account.language': 'Taal',

	// Planningstools
	'plan.drawCurve': 'Panoramacurve tekenen',
	'plan.addNerve': 'Zenuw toevoegen',
	'plan.addImplant': 'Implantaat toevoegen',
	'plan.assignSleeves': 'Hulzen toewijzen',
	'plan.generateGuide': 'Boormal genereren',
	'plan.buildModel': 'Model bouwen',
	'plan.measurements': 'Metingen',
	'plan.measureDistance': 'Afstand meten',
	'plan.measureAngle': 'Hoek meten',
	'plan.density': 'Botdichtheid',
	'plan.segmentation': 'Segmentatie',
	'plan.crossSection': 'Dwarsdoorsnede',
	'plan.sleeveOffset': 'Hulsoffset',

	// Weergaven
	'viewer.axial': 'Axiaal',
	'viewer.coronal': 'Coronaal',
	'viewer.sagittal': 'Sagittaal',
	'viewer.3d': '3D',
	'viewer.sliceOf': 'Snede {n} van {total}',

	// Waarschuwingen
	'warn.verifyNerve': 'Controleer het zenuwverloop handmatig',
	'warn.safetyDistance':
		'Implantaat {label} ligt {dist} mm van de zenuw — minder dan de veiligheidsafstand van {min} mm.',
	'warn.sleeveCollision':
		'Conflict tussen hulzen gedetecteerd — pas implantaatposities of hulsoffsets aan.',
	'warn.unsaved': 'U hebt niet-opgeslagen wijzigingen.',

	// Dialoogtitels
	'dialog.about': 'Over coDiagnostiX web',
	'dialog.onboarding': 'Welkom bij coDiagnostiX web',
	'dialog.printAll': 'Alles afdrukken',
	'dialog.qrExport': 'QR-export',
	'dialog.confirmDelete': 'Verwijderen bevestigen',

	// Rapport
	'report.title': 'Chirurgisch planningsrapport'
};

export default nl;
