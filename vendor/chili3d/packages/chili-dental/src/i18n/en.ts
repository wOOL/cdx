// English strings for the dental restoration layer. Merged into the upstream
// "en" locale at startup via I18n.combineTranslation (DentalModule.i18n()).

const en: Record<string, string> = {
    // ribbon
    "ribbon.tab.restoration": "Restoration",
    "ribbon.group.dental.case": "Case",
    "ribbon.group.dental.design": "Design",
    "ribbon.group.dental.output": "Output",
    // commands
    "command.dental.start": "Open Restoration",
    "command.dental.autotag": "Auto-tag Teeth (AI)",
    "command.dental.select": "Select Tooth",
    "command.dental.margin": "Margin Line",
    "command.dental.axis": "Insertion Axis",
    "command.dental.propose": "Propose Crown",
    // toasts / prompts
    "toast.dental.started": "Restoration workflow ready",
    "toast.dental.noscan": "Import a surface scan first (no mesh in the document)",
    "toast.dental.segmenting": "Segmenting teeth with AI…",
    "toast.dental.tagged": "Tagged {0} teeth: {1}",
    "toast.dental.failed": "Tooth segmentation failed: {0}",
    "prompt.dental.clicktooth": "Click a tooth on the scan to select it (Esc to cancel)",
    "toast.dental.selected": "Selected tooth FDI {0}",
    "toast.dental.selectedgingiva": "No tooth at that point (gingiva)",
    "toast.dental.noselection": "Select a tooth first (Select Tooth)",
    "toast.dental.margindone": "Margin line traced for FDI {0}",
    "toast.dental.nomargin": "No margin boundary found for FDI {0}",
    "toast.dental.axisdone": "Insertion axis shown for FDI {0}",
    "toast.dental.notagged": "Run Auto-tag Teeth (AI) first",
    "toast.dental.nogap": "No single-tooth gap detected to restore",
    "toast.dental.proposing": "Proposing a crown for FDI {0}…",
    "toast.dental.proposed": "Proposed a crown for FDI {0}",
};

export default en;
