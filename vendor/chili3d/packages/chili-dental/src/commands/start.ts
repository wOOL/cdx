// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).

import { command, IApplication, ICommand, Logger } from "chili-core";
import { CMD_START } from "../keys";

/**
 * Entry point for the DWOS-style restoration workflow. For now this brings the
 * workflow online (the host page drives the station sequence over the bridge);
 * subsequent stations register as their own commands in this same ribbon tab.
 */
@command({
    key: CMD_START,
    icon: "icon-import",
})
export class DentalStartCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const doc = application.activeView?.document;
        Logger.info(`[dental] Restoration workflow opened — document: ${doc?.name ?? "(none)"}`);
    }
}
