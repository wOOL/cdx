/** Deutsch (German). */
const de: Record<string, string> = {
	// Planungs-Workflow
	'stage.data': 'Daten',
	'stage.align': 'Ausrichten',
	'stage.panoramic': 'Panorama',
	'stage.nerve': 'Nerv',
	'stage.implants': 'Implantate',
	'stage.sleeves': 'Hülsen',
	'stage.guide': 'Schablone',
	'stage.report': 'Bericht',

	// DentalDB-Werkzeugleiste
	'db.title': 'DentalDB',
	'db.newPatient': 'Neuer Patient',
	'db.editPatient': 'Patient bearbeiten',
	'db.deletePatient': 'Patient löschen',
	'db.newCase': 'Neuer Fall',
	'db.openCase': 'Fall öffnen',
	'db.anonymize': 'Anonymisieren',
	'db.exportCase': 'Fall exportieren',
	'db.importCase': 'Fall importieren',
	'db.patients': 'Patienten',
	'db.cases': 'Fälle',

	// Allgemeine Schaltflächen & Beschriftungen
	'common.save': 'Speichern',
	'common.cancel': 'Abbrechen',
	'common.close': 'Schließen',
	'common.delete': 'Löschen',
	'common.import': 'Importieren',
	'common.export': 'Exportieren',
	'common.print': 'Drucken',
	'common.undo': 'Rückgängig',
	'common.redo': 'Wiederholen',
	'common.search': 'Suchen',
	'common.ok': 'OK',
	'common.yes': 'Ja',
	'common.no': 'Nein',
	'common.edit': 'Bearbeiten',
	'common.new': 'Neu',
	'common.open': 'Öffnen',
	'common.apply': 'Übernehmen',
	'common.reset': 'Zurücksetzen',
	'common.back': 'Zurück',
	'common.next': 'Weiter',
	'common.done': 'Fertig',
	'common.loading': 'Wird geladen…',
	'common.error': 'Fehler',
	'common.warning': 'Warnung',
	'common.settings': 'Einstellungen',
	'common.help': 'Hilfe',
	'common.name': 'Name',
	'common.date': 'Datum',
	'common.status': 'Status',
	'common.actions': 'Aktionen',
	'common.patient': 'Patient',
	'common.case': 'Fall',

	// Einstellungen
	'settings.title': 'Einstellungen',
	'settings.general': 'Allgemein',
	'settings.appearance': 'Darstellung',
	'settings.dicom': 'DICOM-Import',
	'settings.users': 'Benutzer',
	'settings.audit': 'Audit-Protokoll',
	'settings.backup': 'Sicherung',
	'settings.practice': 'Praxisinformationen',
	'settings.language': 'Sprache',
	'settings.languageNote': 'Der Planungsarbeitsplatz übernimmt übersetzte Texte schrittweise.',

	// Anmeldung / Registrierung
	'auth.signIn': 'Anmelden',
	'auth.signOut': 'Abmelden',
	'auth.email': 'E-Mail',
	'auth.password': 'Passwort',
	'auth.confirmPassword': 'Passwort bestätigen',
	'auth.createAccount': 'Konto erstellen',
	'auth.newHere': 'Neu hier?',
	'auth.noAccounts': 'Noch keine Konten — erstellen Sie das erste:',
	'auth.mfaHint':
		'Die Zwei-Faktor-Authentifizierung ist aktiviert — geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.',
	'auth.mfaCode': 'Authenticator-Code',
	'auth.verify': 'Überprüfen',
	'auth.startOver': 'Neu beginnen',
	'auth.register': 'Registrieren',

	// Seitentitel
	'page.inbox': 'Posteingang',
	'page.contacts': 'Kontakte',
	'page.account': 'Konto',
	'page.orders': 'Bestellungen',
	'page.evaluation': 'Auswertung',
	'page.patients': 'Patienten',

	// Kontoseite
	'account.profile': 'Profil',
	'account.tier': 'Stufe',
	'account.credits': 'Exportguthaben',
	'account.saveProfile': 'Profil speichern',
	'account.changePassword': 'Passwort ändern',
	'account.currentPassword': 'Aktuelles Passwort',
	'account.newPassword': 'Neues Passwort (mind. 8)',
	'account.buyCredits': '10 Guthaben kaufen',
	'account.creditsNote':
		'Jeder Export einer Bohrschablone für die Fertigung verbraucht ein Guthaben.',
	'account.remaining': 'Verbleibend',
	'account.mfa': 'Zwei-Faktor-Authentifizierung (TOTP)',
	'account.usersTiers': 'Benutzer & Stufen',
	'account.saved': 'Gespeichert',
	'account.language': 'Sprache',

	// Planungswerkzeuge
	'plan.drawCurve': 'Panoramakurve zeichnen',
	'plan.addNerve': 'Nerv hinzufügen',
	'plan.addImplant': 'Implantat hinzufügen',
	'plan.assignSleeves': 'Hülsen zuweisen',
	'plan.generateGuide': 'Schablone erzeugen',
	'plan.buildModel': 'Modell erstellen',
	'plan.measurements': 'Messungen',
	'plan.measureDistance': 'Distanz messen',
	'plan.measureAngle': 'Winkel messen',
	'plan.density': 'Knochendichte',
	'plan.segmentation': 'Segmentierung',
	'plan.crossSection': 'Querschnitt',
	'plan.sleeveOffset': 'Hülsenversatz',

	// Ansichten
	'viewer.axial': 'Axial',
	'viewer.coronal': 'Koronal',
	'viewer.sagittal': 'Sagittal',
	'viewer.3d': '3D',
	'viewer.sliceOf': 'Schicht {n} von {total}',

	// Warnungen
	'warn.verifyNerve': 'Überprüfen Sie den Nervverlauf manuell',
	'warn.safetyDistance':
		'Implantat {label} ist {dist} mm vom Nerv entfernt — unterhalb des Sicherheitsabstands von {min} mm.',
	'warn.sleeveCollision':
		'Hülsenkollision erkannt — passen Sie Implantatpositionen oder Hülsenversätze an.',
	'warn.unsaved': 'Sie haben ungespeicherte Änderungen.',

	// Dialogtitel
	'dialog.about': 'Über coDiagnostiX web',
	'dialog.onboarding': 'Willkommen bei coDiagnostiX web',
	'dialog.printAll': 'Alle drucken',
	'dialog.qrExport': 'QR-Export',
	'dialog.confirmDelete': 'Löschen bestätigen',

	// Bericht
	'report.title': 'Chirurgischer Planungsbericht'
};

export default de;
