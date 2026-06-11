/**
 * English — reference locale. All other locale files must export exactly the
 * same key set (enforced by scripts/test-i18n.ts).
 */
const en: Record<string, string> = {
	// Planning workflow stages
	'stage.data': 'Data',
	'stage.align': 'Align',
	'stage.panoramic': 'Panoramic',
	'stage.nerve': 'Nerve',
	'stage.implants': 'Implants',
	'stage.sleeves': 'Sleeves',
	'stage.guide': 'Guide',
	'stage.report': 'Report',

	// DentalDB toolbar
	'db.title': 'DentalDB',
	'db.newPatient': 'New patient',
	'db.editPatient': 'Edit patient',
	'db.deletePatient': 'Delete patient',
	'db.newCase': 'New case',
	'db.openCase': 'Open case',
	'db.anonymize': 'Anonymize',
	'db.exportCase': 'Export case',
	'db.importCase': 'Import case',
	'db.patients': 'Patients',
	'db.cases': 'Cases',

	// Common buttons & labels
	'common.save': 'Save',
	'common.cancel': 'Cancel',
	'common.close': 'Close',
	'common.delete': 'Delete',
	'common.import': 'Import',
	'common.export': 'Export',
	'common.print': 'Print',
	'common.undo': 'Undo',
	'common.redo': 'Redo',
	'common.search': 'Search',
	'common.ok': 'OK',
	'common.yes': 'Yes',
	'common.no': 'No',
	'common.edit': 'Edit',
	'common.new': 'New',
	'common.open': 'Open',
	'common.apply': 'Apply',
	'common.reset': 'Reset',
	'common.back': 'Back',
	'common.next': 'Next',
	'common.done': 'Done',
	'common.loading': 'Loading…',
	'common.error': 'Error',
	'common.warning': 'Warning',
	'common.settings': 'Settings',
	'common.help': 'Help',
	'common.name': 'Name',
	'common.date': 'Date',
	'common.status': 'Status',
	'common.actions': 'Actions',
	'common.patient': 'Patient',
	'common.case': 'Case',

	// Settings tabs & labels
	'settings.title': 'Settings',
	'settings.general': 'General',
	'settings.appearance': 'Appearance',
	'settings.dicom': 'DICOM import',
	'settings.users': 'Users',
	'settings.audit': 'Audit log',
	'settings.backup': 'Backup',
	'settings.practice': 'Practice information',
	'settings.language': 'Language',
	'settings.languageNote': 'The planning workspace adopts translated strings progressively.',

	// Sign-in / registration
	'auth.signIn': 'Sign in',
	'auth.signOut': 'Sign out',
	'auth.email': 'Email',
	'auth.password': 'Password',
	'auth.confirmPassword': 'Confirm password',
	'auth.createAccount': 'Create an account',
	'auth.newHere': 'New here?',
	'auth.noAccounts': 'No accounts yet — create the first one:',
	'auth.mfaHint':
		'Two-factor authentication is enabled — enter the 6-digit code from your authenticator app.',
	'auth.mfaCode': 'Authenticator code',
	'auth.verify': 'Verify',
	'auth.startOver': 'Start over',
	'auth.register': 'Register',

	// Page titles
	'page.inbox': 'Inbox',
	'page.contacts': 'Contacts',
	'page.account': 'Account',
	'page.orders': 'Orders',
	'page.evaluation': 'Evaluation',
	'page.patients': 'Patients',

	// Account page
	'account.profile': 'Profile',
	'account.tier': 'Tier',
	'account.credits': 'Export credits',
	'account.saveProfile': 'Save profile',
	'account.changePassword': 'Change password',
	'account.currentPassword': 'Current password',
	'account.newPassword': 'New password (min. 8)',
	'account.buyCredits': 'Buy 10 credits',
	'account.creditsNote': 'Each surgical-guide export for production consumes one credit.',
	'account.remaining': 'Remaining',
	'account.mfa': 'Two-factor authentication (TOTP)',
	'account.usersTiers': 'Users & tiers',
	'account.saved': 'Saved',
	'account.language': 'Language',

	// Planning tools
	'plan.drawCurve': 'Draw panoramic curve',
	'plan.addNerve': 'Add nerve',
	'plan.addImplant': 'Add implant',
	'plan.assignSleeves': 'Assign sleeves',
	'plan.generateGuide': 'Generate guide',
	'plan.buildModel': 'Build model',
	'plan.measurements': 'Measurements',
	'plan.measureDistance': 'Measure distance',
	'plan.measureAngle': 'Measure angle',
	'plan.density': 'Bone density',
	'plan.segmentation': 'Segmentation',
	'plan.crossSection': 'Cross section',
	'plan.sleeveOffset': 'Sleeve offset',

	// Viewers
	'viewer.axial': 'Axial',
	'viewer.coronal': 'Coronal',
	'viewer.sagittal': 'Sagittal',
	'viewer.3d': '3D',
	'viewer.sliceOf': 'Slice {n} of {total}',

	// Warnings
	'warn.verifyNerve': 'Verify the nerve course manually',
	'warn.safetyDistance':
		'Implant {label} is {dist} mm from the nerve — below the {min} mm safety distance.',
	'warn.sleeveCollision': 'Sleeve collision detected — adjust implant positions or sleeve offsets.',
	'warn.unsaved': 'You have unsaved changes.',

	// Dialog titles
	'dialog.about': 'About coDiagnostiX web',
	'dialog.onboarding': 'Welcome to coDiagnostiX web',
	'dialog.printAll': 'Print all',
	'dialog.qrExport': 'QR export',
	'dialog.confirmDelete': 'Confirm deletion',

	// Report
	'report.title': 'Surgical planning report'
};

export default en;
