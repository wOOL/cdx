/** Italiano (Italian). */
const it: Record<string, string> = {
	// Fasi del flusso di pianificazione
	'stage.data': 'Dati',
	'stage.align': 'Allineamento',
	'stage.panoramic': 'Panoramica',
	'stage.nerve': 'Nervo',
	'stage.implants': 'Impianti',
	'stage.sleeves': 'Boccole',
	'stage.guide': 'Dima',
	'stage.report': 'Report',

	// Barra degli strumenti DentalDB
	'db.title': 'DentalDB',
	'db.newPatient': 'Nuovo paziente',
	'db.editPatient': 'Modifica paziente',
	'db.deletePatient': 'Elimina paziente',
	'db.newCase': 'Nuovo caso',
	'db.openCase': 'Apri caso',
	'db.anonymize': 'Anonimizza',
	'db.exportCase': 'Esporta caso',
	'db.importCase': 'Importa caso',
	'db.patients': 'Pazienti',
	'db.cases': 'Casi',

	// Pulsanti ed etichette comuni
	'common.save': 'Salva',
	'common.cancel': 'Annulla',
	'common.close': 'Chiudi',
	'common.delete': 'Elimina',
	'common.import': 'Importa',
	'common.export': 'Esporta',
	'common.print': 'Stampa',
	'common.undo': 'Annulla operazione',
	'common.redo': 'Ripeti',
	'common.search': 'Cerca',
	'common.ok': 'OK',
	'common.yes': 'Sì',
	'common.no': 'No',
	'common.edit': 'Modifica',
	'common.new': 'Nuovo',
	'common.open': 'Apri',
	'common.apply': 'Applica',
	'common.reset': 'Reimposta',
	'common.back': 'Indietro',
	'common.next': 'Avanti',
	'common.done': 'Fatto',
	'common.loading': 'Caricamento…',
	'common.error': 'Errore',
	'common.warning': 'Avviso',
	'common.settings': 'Impostazioni',
	'common.help': 'Aiuto',
	'common.name': 'Nome',
	'common.date': 'Data',
	'common.status': 'Stato',
	'common.actions': 'Azioni',
	'common.patient': 'Paziente',
	'common.case': 'Caso',

	// Impostazioni
	'settings.title': 'Impostazioni',
	'settings.general': 'Generale',
	'settings.appearance': 'Aspetto',
	'settings.dicom': 'Importazione DICOM',
	'settings.users': 'Utenti',
	'settings.audit': 'Registro di controllo',
	'settings.backup': 'Backup',
	'settings.practice': 'Informazioni dello studio',
	'settings.language': 'Lingua',
	'settings.languageNote':
		"L'area di pianificazione adotta progressivamente i testi tradotti.",

	// Accesso / registrazione
	'auth.signIn': 'Accedi',
	'auth.signOut': 'Esci',
	'auth.email': 'E-mail',
	'auth.password': 'Password',
	'auth.confirmPassword': 'Conferma password',
	'auth.createAccount': 'Crea un account',
	'auth.newHere': 'Sei nuovo?',
	'auth.noAccounts': 'Ancora nessun account — crea il primo:',
	'auth.mfaHint':
		"L'autenticazione a due fattori è attiva — inserisci il codice a 6 cifre della tua app di autenticazione.",
	'auth.mfaCode': 'Codice di autenticazione',
	'auth.verify': 'Verifica',
	'auth.startOver': 'Ricomincia',
	'auth.register': 'Registrati',

	// Titoli delle pagine
	'page.inbox': 'Posta in arrivo',
	'page.contacts': 'Contatti',
	'page.account': 'Account',
	'page.orders': 'Ordini',
	'page.evaluation': 'Valutazione',
	'page.patients': 'Pazienti',

	// Pagina Account
	'account.profile': 'Profilo',
	'account.tier': 'Livello',
	'account.credits': 'Crediti di esportazione',
	'account.saveProfile': 'Salva profilo',
	'account.changePassword': 'Cambia password',
	'account.currentPassword': 'Password attuale',
	'account.newPassword': 'Nuova password (min. 8)',
	'account.buyCredits': 'Acquista 10 crediti',
	'account.creditsNote':
		'Ogni esportazione di una dima chirurgica per la produzione consuma un credito.',
	'account.remaining': 'Rimanenti',
	'account.mfa': 'Autenticazione a due fattori (TOTP)',
	'account.usersTiers': 'Utenti e livelli',
	'account.saved': 'Salvato',
	'account.language': 'Lingua',

	// Strumenti di pianificazione
	'plan.drawCurve': 'Disegna curva panoramica',
	'plan.addNerve': 'Aggiungi nervo',
	'plan.addImplant': 'Aggiungi impianto',
	'plan.assignSleeves': 'Assegna boccole',
	'plan.generateGuide': 'Genera dima',
	'plan.buildModel': 'Costruisci modello',
	'plan.measurements': 'Misurazioni',
	'plan.measureDistance': 'Misura distanza',
	'plan.measureAngle': 'Misura angolo',
	'plan.density': 'Densità ossea',
	'plan.segmentation': 'Segmentazione',
	'plan.crossSection': 'Sezione trasversale',
	'plan.sleeveOffset': 'Offset della boccola',

	// Viste
	'viewer.axial': 'Assiale',
	'viewer.coronal': 'Coronale',
	'viewer.sagittal': 'Sagittale',
	'viewer.3d': '3D',
	'viewer.sliceOf': 'Sezione {n} di {total}',

	// Avvisi
	'warn.verifyNerve': 'Verificare manualmente il decorso del nervo',
	'warn.safetyDistance':
		"L'impianto {label} è a {dist} mm dal nervo — al di sotto della distanza di sicurezza di {min} mm.",
	'warn.sleeveCollision':
		'Rilevata collisione tra boccole — regolare le posizioni degli impianti o gli offset delle boccole.',
	'warn.unsaved': 'Sono presenti modifiche non salvate.',

	// Titoli delle finestre di dialogo
	'dialog.about': 'Informazioni su coDiagnostiX web',
	'dialog.onboarding': 'Benvenuto in coDiagnostiX web',
	'dialog.printAll': 'Stampa tutto',
	'dialog.qrExport': 'Esportazione QR',
	'dialog.confirmDelete': 'Conferma eliminazione',

	// Report
	'report.title': 'Report di pianificazione chirurgica'
};

export default it;
