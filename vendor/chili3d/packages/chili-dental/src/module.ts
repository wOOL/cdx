// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).

import type { Locale } from "chili-core";
import type { AdditionalCommand, IAdditionalModule } from "chili-builder";
import en from "./i18n/en";
import {
    CMD_ADDMAT,
    CMD_AUTOTAG,
    CMD_AXIS,
    CMD_MARGIN,
    CMD_MATCH,
    CMD_OPTIMIZE,
    CMD_PROPOSE,
    CMD_REMMAT,
    CMD_SELECT,
    CMD_START,
    DENTAL_TAB,
    GROUP_CASE,
    GROUP_DESIGN,
    GROUP_SCAN,
    GROUP_SHAPE,
} from "./keys";

// Side-effect imports: running each module executes its @command decorator,
// registering the command in the global registry keyed by its string.
import "./commands/start";
import "./commands/optimize";
import "./commands/matchScan";
import "./commands/autoTag";
import "./commands/selectTooth";
import "./commands/margin";
import "./commands/insertionAxis";
import "./commands/proposeCrown";
import "./commands/sculpt";

/**
 * DWOS-style dental restoration design layer, registered with the Chili3D
 * AppBuilder via addAdditionalModules(). Contributes the "Restoration" ribbon
 * tab and the dental station commands, plus their English display strings.
 */
export class DentalModule implements IAdditionalModule {
    i18n(): Locale[] {
        return [
            {
                display: "English",
                code: "en",
                translation: en as unknown as Locale["translation"],
            },
        ];
    }

    ribbonCommands(): AdditionalCommand[] {
        return [
            { tabName: DENTAL_TAB, groupName: GROUP_CASE, command: CMD_START },
            { tabName: DENTAL_TAB, groupName: GROUP_SCAN, command: CMD_OPTIMIZE },
            { tabName: DENTAL_TAB, groupName: GROUP_SCAN, command: CMD_MATCH },
            { tabName: DENTAL_TAB, groupName: GROUP_DESIGN, command: CMD_AUTOTAG },
            { tabName: DENTAL_TAB, groupName: GROUP_DESIGN, command: CMD_SELECT },
            { tabName: DENTAL_TAB, groupName: GROUP_DESIGN, command: CMD_MARGIN },
            { tabName: DENTAL_TAB, groupName: GROUP_DESIGN, command: CMD_AXIS },
            { tabName: DENTAL_TAB, groupName: GROUP_DESIGN, command: CMD_PROPOSE },
            { tabName: DENTAL_TAB, groupName: GROUP_SHAPE, command: CMD_ADDMAT },
            { tabName: DENTAL_TAB, groupName: GROUP_SHAPE, command: CMD_REMMAT },
        ];
    }
}
