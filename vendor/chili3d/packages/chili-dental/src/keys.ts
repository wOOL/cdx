// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// The dental commands and ribbon entries use their own i18n key namespace. The
// upstream CommandKeys / I18nKeys are unions derived from a const key array, so
// our keys are not members at the type level; their display strings are supplied
// at runtime via DentalModule.i18n() (I18n.combineTranslation accepts open keys).
// We therefore cast at the API boundary — the runtime registry keys by string.

import type { CommandKeys, I18nKeys } from "chili-core";

const i18nKey = (s: string) => s as unknown as I18nKeys;
const cmdKey = (s: string) => s as unknown as CommandKeys;

/** Cast an arbitrary dental i18n key (toast/prompt) to I18nKeys for runtime APIs. */
export const t = (s: string) => s as unknown as I18nKeys;

// Ribbon tab + groups (DWOS station grouping).
export const DENTAL_TAB = i18nKey("ribbon.tab.restoration");
export const GROUP_CASE = i18nKey("ribbon.group.dental.case");
export const GROUP_SCAN = i18nKey("ribbon.group.dental.scan");
export const GROUP_DESIGN = i18nKey("ribbon.group.dental.design");
export const GROUP_SHAPE = i18nKey("ribbon.group.dental.shape");
export const GROUP_OUTPUT = i18nKey("ribbon.group.dental.output");

// Command keys (registry id == string after `command.`).
export const CMD_START = cmdKey("dental.start");
export const CMD_OPTIMIZE = cmdKey("dental.optimize");
export const CMD_MATCH = cmdKey("dental.match");
export const CMD_AUTOTAG = cmdKey("dental.autotag");
export const CMD_SELECT = cmdKey("dental.select");
export const CMD_MARGIN = cmdKey("dental.margin");
export const CMD_EDITMARGIN = cmdKey("dental.editmargin");
export const CMD_AXIS = cmdKey("dental.axis");
export const CMD_PROPOSE = cmdKey("dental.propose");
export const CMD_ADDMAT = cmdKey("dental.addmat");
export const CMD_REMMAT = cmdKey("dental.remmat");
export const CMD_NEST = cmdKey("dental.nest");
