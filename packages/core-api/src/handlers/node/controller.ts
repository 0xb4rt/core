import { Container, Contracts, Providers, Utils } from "@arkecosystem/core-kernel";
import { Crypto, Managers } from "@arkecosystem/crypto";
import Boom from "@hapi/boom";
import Hapi from "@hapi/hapi";
import { spawnSync } from "child_process";
import { existsSync } from "fs";

import { Controller } from "../shared/controller";

// todo: remove the abstract and use dependency injection if needed
@Container.injectable()
export class NodeController extends Controller {
    public async status(request: Hapi.Request, h: Hapi.ResponseToolkit) {
        try {
            const lastBlock = this.blockchain.getLastBlock();
            // todo: inject from container
            const networkHeight = this.app
                .get<Contracts.P2P.INetworkMonitor>(Container.Identifiers.PeerNetworkMonitor)
                .getNetworkHeight();

            return {
                data: {
                    synced: this.blockchain.isSynced(),
                    now: lastBlock ? lastBlock.data.height : 0,
                    blocksCount: networkHeight - lastBlock.data.height || 0,
                    timestamp: Crypto.Slots.getTime(),
                },
            };
        } catch (error) {
            return Boom.badImplementation(error);
        }
    }

    public async syncing(request: Hapi.Request, h: Hapi.ResponseToolkit) {
        try {
            const lastBlock = this.blockchain.getLastBlock();
            // todo: inject from container
            const networkHeight = this.app
                .get<Contracts.P2P.INetworkMonitor>(Container.Identifiers.PeerNetworkMonitor)
                .getNetworkHeight();

            return {
                data: {
                    syncing: !this.blockchain.isSynced(),
                    blocks: networkHeight - lastBlock.data.height || 0,
                    height: lastBlock.data.height,
                    id: lastBlock.data.id,
                },
            };
        } catch (error) {
            return Boom.badImplementation(error);
        }
    }

    public async configuration(request: Hapi.Request, h: Hapi.ResponseToolkit) {
        try {
            const network = Managers.configManager.get("network");
            const dynamicFees: Record<string, any> = Utils.assert.defined(
                this.app
                    .get<Providers.ServiceProviderRepository>(Container.Identifiers.ServiceProviderRepository)
                    .get("transactionPool")
                    .config()
                    .get<{ enabled?: boolean }>("dynamicFees"),
            );

            return {
                data: {
                    core: {
                        version: this.app.version(),
                    },
                    nethash: network.nethash,
                    slip44: network.slip44,
                    wif: network.wif,
                    token: network.client.token,
                    symbol: network.client.symbol,
                    explorer: network.client.explorer,
                    version: network.pubKeyHash,
                    ports: super.toResource(this.configRepository, "ports"),
                    constants: Managers.configManager.getMilestone(this.blockchain.getLastHeight()),
                    transactionPool: {
                        dynamicFees: dynamicFees.enabled ? dynamicFees : { enabled: false },
                    },
                },
            };
        } catch (error) {
            return Boom.badImplementation(error);
        }
    }

    public async configurationCrypto() {
        try {
            return {
                data: Managers.configManager.all(),
            };
        } catch (error) {
            return Boom.badImplementation(error);
        }
    }

    public async fees(request: Hapi.Request) {
        // todo: inject from container
        const { transactionsBusinessRepository } = this.app.get<Contracts.Database.DatabaseService>(
            Container.Identifiers.DatabaseService,
        );

        // @ts-ignore
        const results = await transactionsBusinessRepository.getFeeStatistics(request.query.days);

        return { meta: { days: request.query.days }, data: results };
    }

    public async debug(request: Hapi.Request, h) {
        const logPath: string | undefined = Utils.assert.defined(process.env.CORE_PATH_LOG);
        const logFile: string = `${logPath}/${this.app.token()}-current.log`;

        if (!existsSync(logFile)) {
            return Boom.notFound(logFile);
        }

        const log: string = spawnSync("tail", ["-n", `${request.query.lines}`, logFile]).output.toString();

        return h.response(log).type("text/plain");
    }
}
