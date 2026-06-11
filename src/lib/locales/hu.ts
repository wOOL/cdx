/** Magyar (Hungarian). */
const hu: Record<string, string> = {
	// Tervezési munkafolyamat lépései
	'stage.data': 'Adatok',
	'stage.align': 'Igazítás',
	'stage.panoramic': 'Panoráma',
	'stage.nerve': 'Ideg',
	'stage.implants': 'Implantátumok',
	'stage.sleeves': 'Hüvelyek',
	'stage.guide': 'Sablon',
	'stage.report': 'Jelentés',

	// DentalDB eszköztár
	'db.title': 'DentalDB',
	'db.newPatient': 'Új páciens',
	'db.editPatient': 'Páciens szerkesztése',
	'db.deletePatient': 'Páciens törlése',
	'db.newCase': 'Új eset',
	'db.openCase': 'Eset megnyitása',
	'db.anonymize': 'Anonimizálás',
	'db.exportCase': 'Eset exportálása',
	'db.importCase': 'Eset importálása',
	'db.patients': 'Páciensek',
	'db.cases': 'Esetek',

	// Általános gombok és címkék
	'common.save': 'Mentés',
	'common.cancel': 'Mégse',
	'common.close': 'Bezárás',
	'common.delete': 'Törlés',
	'common.import': 'Importálás',
	'common.export': 'Exportálás',
	'common.print': 'Nyomtatás',
	'common.undo': 'Visszavonás',
	'common.redo': 'Újra',
	'common.search': 'Keresés',
	'common.ok': 'OK',
	'common.yes': 'Igen',
	'common.no': 'Nem',
	'common.edit': 'Szerkesztés',
	'common.new': 'Új',
	'common.open': 'Megnyitás',
	'common.apply': 'Alkalmaz',
	'common.reset': 'Visszaállítás',
	'common.back': 'Vissza',
	'common.next': 'Tovább',
	'common.done': 'Kész',
	'common.loading': 'Betöltés…',
	'common.error': 'Hiba',
	'common.warning': 'Figyelmeztetés',
	'common.settings': 'Beállítások',
	'common.help': 'Súgó',
	'common.name': 'Név',
	'common.date': 'Dátum',
	'common.status': 'Állapot',
	'common.actions': 'Műveletek',
	'common.patient': 'Páciens',
	'common.case': 'Eset',

	// Beállítások
	'settings.title': 'Beállítások',
	'settings.general': 'Általános',
	'settings.appearance': 'Megjelenés',
	'settings.dicom': 'DICOM-importálás',
	'settings.users': 'Felhasználók',
	'settings.audit': 'Auditnapló',
	'settings.backup': 'Biztonsági mentés',
	'settings.practice': 'Rendelőadatok',
	'settings.language': 'Nyelv',
	'settings.languageNote': 'A tervezőfelület fokozatosan veszi át a lefordított szövegeket.',

	// Bejelentkezés / regisztráció
	'auth.signIn': 'Bejelentkezés',
	'auth.signOut': 'Kijelentkezés',
	'auth.email': 'E-mail',
	'auth.password': 'Jelszó',
	'auth.confirmPassword': 'Jelszó megerősítése',
	'auth.createAccount': 'Fiók létrehozása',
	'auth.newHere': 'Még új itt?',
	'auth.noAccounts': 'Még nincs fiók — hozza létre az elsőt:',
	'auth.mfaHint':
		'A kétfaktoros hitelesítés engedélyezve van — adja meg a hitelesítő alkalmazás 6 számjegyű kódját.',
	'auth.mfaCode': 'Hitelesítő kód',
	'auth.verify': 'Ellenőrzés',
	'auth.startOver': 'Újrakezdés',
	'auth.register': 'Regisztráció',

	// Oldalcímek
	'page.inbox': 'Beérkezett üzenetek',
	'page.contacts': 'Kapcsolatok',
	'page.account': 'Fiók',
	'page.orders': 'Rendelések',
	'page.evaluation': 'Kiértékelés',
	'page.patients': 'Páciensek',

	// Fiók oldal
	'account.profile': 'Profil',
	'account.tier': 'Szint',
	'account.credits': 'Exportkreditek',
	'account.saveProfile': 'Profil mentése',
	'account.changePassword': 'Jelszó módosítása',
	'account.currentPassword': 'Jelenlegi jelszó',
	'account.newPassword': 'Új jelszó (min. 8)',
	'account.buyCredits': '10 kredit vásárlása',
	'account.creditsNote':
		'A sebészi sablon gyártási célú exportálása alkalmanként egy kreditet használ fel.',
	'account.remaining': 'Hátralévő',
	'account.mfa': 'Kétfaktoros hitelesítés (TOTP)',
	'account.usersTiers': 'Felhasználók és szintek',
	'account.saved': 'Mentve',
	'account.language': 'Nyelv',

	// Tervezőeszközök
	'plan.drawCurve': 'Panorámagörbe rajzolása',
	'plan.addNerve': 'Ideg hozzáadása',
	'plan.addImplant': 'Implantátum hozzáadása',
	'plan.assignSleeves': 'Hüvelyek hozzárendelése',
	'plan.generateGuide': 'Sablon generálása',
	'plan.buildModel': 'Modell készítése',
	'plan.measurements': 'Mérések',
	'plan.measureDistance': 'Távolságmérés',
	'plan.measureAngle': 'Szögmérés',
	'plan.density': 'Csontsűrűség',
	'plan.segmentation': 'Szegmentálás',
	'plan.crossSection': 'Keresztmetszet',
	'plan.sleeveOffset': 'Hüvelyeltolás',

	// Nézetek
	'viewer.axial': 'Axiális',
	'viewer.coronal': 'Koronális',
	'viewer.sagittal': 'Szagittális',
	'viewer.3d': '3D',
	'viewer.sliceOf': '{n}. szelet, összesen {total}',

	// Figyelmeztetések
	'warn.verifyNerve': 'Ellenőrizze manuálisan az ideg lefutását',
	'warn.safetyDistance':
		'A(z) {label} implantátum {dist} mm-re van az idegtől — a {min} mm-es biztonsági távolság alatt.',
	'warn.sleeveCollision':
		'Hüvelyütközés észlelve — igazítsa az implantátumok pozícióját vagy a hüvelyeltolásokat.',
	'warn.unsaved': 'Nem mentett módosításai vannak.',

	// Párbeszédablak-címek
	'dialog.about': 'A coDiagnostiX web névjegye',
	'dialog.onboarding': 'Üdvözli a coDiagnostiX web',
	'dialog.printAll': 'Összes nyomtatása',
	'dialog.qrExport': 'QR-exportálás',
	'dialog.confirmDelete': 'Törlés megerősítése',

	// Jelentés
	'report.title': 'Sebészi tervezési jelentés'
};

export default hu;
