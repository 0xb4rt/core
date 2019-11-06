import Command, { flags } from "@oclif/command";

import { buildPeerOptions } from "../../common/builder";
import { getConfigValue } from "../../common/config";
import { flagsBehaviour, flagsNetwork } from "../../common/flags";
import { parseWithNetwork } from "../../common/parser";
import { CommandFlags } from "../../types";
import { createApplication } from "../../common/create-application";

export class RunCommand extends Command {
    public static description = "Run the relay (without pm2)";

    public static examples: string[] = [
        `Run a relay
$ ark relay:run
`,
        `Run a genesis relay
$ ark relay:run --networkStart
`,
        `Disable any discovery by other peers
$ ark relay:run --disableDiscovery
`,
        `Skip the initial discovery
$ ark relay:run --skipDiscovery
`,
        `Ignore the minimum network reach
$ ark relay:run --ignoreMinimumNetworkReach
`,
        `Start a seed
$ ark relay:run --launchMode=seed
`,
    ];

    public static flags: CommandFlags = {
        ...flagsNetwork,
        ...flagsBehaviour,
        suffix: flags.string({
            hidden: true,
            default: "relay",
        }),
        env: flags.string({
            default: "production",
        }),
    };

    public async run(): Promise<void> {
        const { flags } = await parseWithNetwork(this.parse(RunCommand));

        await createApplication({
            ...getConfigValue(flags, "app", "cli.relay.run"),
            ...{
                flags,
                plugins: {
                    exclude: ["@arkecosystem/core-forger"],
                    // todo: this can actually be removed and done inside the service provider of the packages
                    options: {
                        "@arkecosystem/core-p2p": buildPeerOptions(flags),
                        "@arkecosystem/core-blockchain": {
                            networkStart: flags.networkStart,
                        },
                    },
                },
            },
        });
    }
}
