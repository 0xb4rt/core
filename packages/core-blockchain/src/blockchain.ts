import { DatabaseService, Repositories } from "@arkecosystem/core-database";
import { Container, Contracts, Enums, Utils } from "@arkecosystem/core-kernel";
import { Blocks, Crypto, Interfaces, Managers, Utils as CryptoUtils } from "@arkecosystem/crypto";
import async from "async";

import { BlockProcessor, BlockProcessorResult } from "./processor";
import { stateMachine } from "./state-machine";

const { BlockFactory } = Blocks;

// todo: reduce the overall complexity of this class and remove all helpers and getters that just serve as proxies
@Container.injectable()
export class Blockchain implements Contracts.Blockchain.Blockchain {
    @Container.inject(Container.Identifiers.Application)
    public readonly app!: Contracts.Kernel.Application;

    // todo: make this private
    public isStopped!: boolean;
    // todo: make this private
    public options: any;
    // todo: make this private and use a queue instance from core-kernel
    // @ts-ignore
    public queue: async.AsyncQueue<any>;
    // todo: make this private
    // @ts-ignore
    protected blockProcessor: BlockProcessor;
    // todo: add type
    private actions: any;

    // todo: make this private, only protected because of replay
    @Container.inject(Container.Identifiers.StateStore)
    protected readonly state!: Contracts.State.StateStore;

    // todo: make this private, only protected because of replay
    @Container.inject(Container.Identifiers.DatabaseService)
    protected readonly database!: DatabaseService;

    @Container.inject(Container.Identifiers.BlockRepository)
    private readonly blockRepository!: Repositories.BlockRepository;

    // todo: make this private, only protected because of replay
    @Container.inject(Container.Identifiers.TransactionPoolService)
    protected readonly transactionPool!: Contracts.TransactionPool.Connection;

    /**
     * Create a new blockchain manager instance.
     * @param  {Object} options
     * @return {void}
     */
    init(options: { networkStart?: boolean }): this {
        this.isStopped = true;

        // flag to force a network start
        this.state.networkStart = !!options.networkStart;

        if (this.state.networkStart) {
            this.app.log.warning(
                "ARK Core is launched in Genesis Start mode. This is usually for starting the first node on the blockchain. Unless you know what you are doing, this is likely wrong.",
            );
        }

        this.actions = stateMachine.actionMap(this);
        this.blockProcessor = this.app.resolve<BlockProcessor>(BlockProcessor);

        this.queue = async.queue((blockList: { blocks: Interfaces.IBlockData[] }, cb) => {
            try {
                return this.processBlocks(
                    blockList.blocks.map(b => {
                        const block: Interfaces.IBlock | undefined = Blocks.BlockFactory.fromData(b);

                        Utils.assert.defined<Interfaces.IBlock>(block);

                        return block;
                    }),
                    cb,
                );
            } catch (error) {
                this.app.log.error(
                    `Failed to process ${blockList.blocks.length} blocks from height ${blockList.blocks[0].height} in queue.`,
                );

                this.app.log.error(error.stack);

                return cb();
            }
        }, 1);

        // @ts-ignore
        this.queue.drain(() => this.dispatch("PROCESSFINISHED"));

        return this;
    }

    /**
     * Dispatch an event to transition the state machine.
     * @param  {String} event
     * @return {void}
     */
    public dispatch(event): void {
        const nextState = stateMachine.transition(this.state.blockchain, event);

        if (nextState.actions.length > 0) {
            this.app.log.debug(
                `event '${event}': ${JSON.stringify(this.state.blockchain.value)} -> ${JSON.stringify(
                    nextState.value,
                )} -> actions: [${nextState.actions.map(a => a.type).join(", ")}]`,
            );
        } else {
            this.app.log.debug(
                `event '${event}': ${JSON.stringify(this.state.blockchain.value)} -> ${JSON.stringify(
                    nextState.value,
                )}`,
            );
        }

        this.state.blockchain = nextState;

        for (const actionKey of nextState.actions) {
            const action = this.actions[actionKey];

            if (action) {
                setImmediate(() => action(event));
            } else {
                this.app.log.error(`No action '${actionKey}' found`);
            }
        }

        return nextState;
    }

    /**
     * Start the blockchain and wait for it to be ready.
     * @return {void}
     */
    public async start(skipStartedCheck = false): Promise<boolean> {
        this.app.log.info("Starting Blockchain Manager :chains:");

        this.dispatch("START");

        this.app.events.listenOnce("shutdown", () => this.stop());

        if (skipStartedCheck || process.env.CORE_SKIP_BLOCKCHAIN_STARTED_CHECK) {
            return true;
        }

        while (!this.state.started && !this.isStopped) {
            await Utils.sleep(1000);
        }

        this.app.get<Contracts.P2P.INetworkMonitor>(Container.Identifiers.PeerNetworkMonitor).cleansePeers({
            forcePing: true,
            peerCount: 10,
        });

        return true;
    }

    public async stop(): Promise<void> {
        if (!this.isStopped) {
            this.app.log.info("Stopping Blockchain Manager :chains:");

            this.isStopped = true;
            this.state.clearWakeUpTimeout();

            this.dispatch("STOP");

            this.queue.kill();
        }
    }

    /**
     * Set wakeup timeout to check the network for new blocks.
     */
    public setWakeUp(): void {
        this.state.wakeUpTimeout = setTimeout(() => {
            this.state.wakeUpTimeout = undefined;
            return this.dispatch("WAKEUP");
        }, 60000);
    }

    /**
     * Reset the wakeup timeout.
     */
    public resetWakeUp(): void {
        this.state.clearWakeUpTimeout();
        this.setWakeUp();
    }

    /**
     * Update network status.
     * @return {void}
     */
    public async updateNetworkStatus(): Promise<void> {
        await this.app
            .get<Contracts.P2P.INetworkMonitor>(Container.Identifiers.PeerNetworkMonitor)
            .updateNetworkStatus();
    }

    /**
     * Clear and stop the queue.
     * @return {void}
     */
    public clearAndStopQueue(): void {
        this.state.lastDownloadedBlock = this.getLastBlock().data;

        this.queue.pause();
        this.clearQueue();
    }

    /**
     * Clear the queue.
     * @return {void}
     */
    public clearQueue(): void {
        this.queue.remove(() => true);
    }

    /**
     * Push a block to the process queue.
     */
    public handleIncomingBlock(block: Interfaces.IBlockData, fromForger = false): void {
        this.pushPingBlock(block, fromForger);

        const currentSlot: number = Crypto.Slots.getSlotNumber();
        const receivedSlot: number = Crypto.Slots.getSlotNumber(block.timestamp);

        if (receivedSlot > currentSlot) {
            this.app.log.info(`Discarded block ${block.height.toLocaleString()} because it takes a future slot.`);
            return;
        }

        if (this.state.started) {
            this.dispatch("NEWBLOCK");
            this.enqueueBlocks([block]);

            this.app.events.dispatch(Enums.BlockEvent.Received, block);
        } else {
            this.app.log.info(`Block disregarded because blockchain is not ready`);

            this.app.events.dispatch(Enums.BlockEvent.Disregarded, block);
        }
    }

    /**
     * Enqueue blocks in process queue and set last downloaded block to last item in list.
     */
    public enqueueBlocks(blocks: Interfaces.IBlockData[]): void {
        if (blocks.length === 0) {
            return;
        }

        const lastDownloadedHeight: number = this.getLastDownloadedBlock().height;
        const milestoneHeights: number[] = Managers.configManager
            .getMilestones()
            .map(milestone => milestone.height)
            .sort((a, b) => a - b)
            .filter(height => height >= lastDownloadedHeight);

        // divide blocks received into chunks depending on number of transactions
        // this is to avoid blocking the application when processing "heavy" blocks
        let currentBlocksChunk: any[] = [];
        let currentTransactionsCount = 0;
        for (const block of blocks) {
            Utils.assert.defined<Interfaces.IBlockData>(block);

            currentBlocksChunk.push(block);
            currentTransactionsCount += block.numberOfTransactions;

            const nextMilestone = milestoneHeights[0] && milestoneHeights[0] === block.height;
            if (currentTransactionsCount >= 150 || currentBlocksChunk.length > 100 || nextMilestone) {
                this.queue.push({ blocks: currentBlocksChunk });
                currentBlocksChunk = [];
                currentTransactionsCount = 0;
                if (nextMilestone) {
                    milestoneHeights.shift();
                }
            }
        }
        this.queue.push({ blocks: currentBlocksChunk });

        this.state.lastDownloadedBlock = blocks.slice(-1)[0];
    }

    /**
     * Remove N number of blocks.
     * @param  {Number} nblocks
     * @return {void}
     */
    public async removeBlocks(nblocks: number): Promise<void> {
        this.clearAndStopQueue();

        const lastBlock: Interfaces.IBlock = this.state.getLastBlock();

        // If the current chain height is H and we will be removing blocks [N, H],
        // then blocksToRemove[] will contain blocks [N - 1, H - 1].
        const blocksToRemove: Interfaces.IBlockData[] = await this.database.getBlocks(
            lastBlock.data.height - nblocks,
            nblocks,
        );

        const removedBlocks: Interfaces.IBlockData[] = [];
        const removedTransactions: Interfaces.ITransaction[] = [];

        const revertLastBlock = async () => {
            const lastBlock: Interfaces.IBlock = this.state.getLastBlock();

            await this.database.revertBlock(lastBlock);
            removedBlocks.push(lastBlock.data);
            removedTransactions.push(...[...lastBlock.transactions].reverse());

            let newLastBlock: Interfaces.IBlock;
            if (blocksToRemove[blocksToRemove.length - 1].height === 1) {
                newLastBlock = this.app.get<any>(Container.Identifiers.StateStore).getGenesisBlock();
            } else {
                const tempNewLastBlockData: Interfaces.IBlockData | undefined = blocksToRemove.pop();

                Utils.assert.defined<Interfaces.IBlockData>(tempNewLastBlockData);

                const tempNewLastBlock: Interfaces.IBlock | undefined = BlockFactory.fromData(tempNewLastBlockData, {
                    deserializeTransactionsUnchecked: true,
                });

                Utils.assert.defined<Interfaces.IBlockData>(tempNewLastBlock);

                newLastBlock = tempNewLastBlock;
            }

            this.state.setLastBlock(newLastBlock);
            this.state.lastDownloadedBlock = newLastBlock.data;
        };

        const __removeBlocks = async numberOfBlocks => {
            if (numberOfBlocks < 1) {
                return;
            }

            const lastBlock: Interfaces.IBlock = this.state.getLastBlock();

            this.app.log.info(`Undoing block ${lastBlock.data.height.toLocaleString()}`);

            await revertLastBlock();
            await __removeBlocks(numberOfBlocks - 1);
        };

        if (nblocks >= lastBlock.data.height) {
            nblocks = lastBlock.data.height - 1;
        }

        const resetHeight: number = lastBlock.data.height - nblocks;
        this.app.log.info(
            `Removing ${Utils.pluralize("block", nblocks, true)}. Reset to height ${resetHeight.toLocaleString()}`,
        );

        this.state.lastDownloadedBlock = lastBlock.data;

        await __removeBlocks(nblocks);

        await this.blockRepository.deleteBlocks(removedBlocks);

        if (this.transactionPool) {
            await this.transactionPool.replay(removedTransactions.reverse());
        }
    }

    /**
     * Remove the top blocks from database.
     * NOTE: Only used when trying to restore database integrity.
     * @param  {Number} count
     * @return {void}
     */
    public async removeTopBlocks(count: number): Promise<void> {
        const blocks: Interfaces.IBlockData[] = await this.database.getTopBlocks(count);

        this.app.log.info(
            `Removing ${Utils.pluralize(
                "block",
                blocks.length,
                true,
            )} from height ${(blocks[0] as any).height.toLocaleString()}`,
        );

        try {
            await this.blockRepository.deleteBlocks(blocks);
            await this.database.loadBlocksFromCurrentRound();
        } catch (error) {
            this.app.log.error(`Encountered error while removing blocks: ${error.message}`);
        }
    }

    /**
     * Process the given block.
     */
    public async processBlocks(blocks: Interfaces.IBlock[], callback): Promise<Interfaces.IBlock[]> {
        const acceptedBlocks: Interfaces.IBlock[] = [];
        let lastProcessResult: BlockProcessorResult | undefined;

        if (
            blocks[0] &&
            !Utils.isBlockChained(this.getLastBlock().data, blocks[0].data, this.app.log) &&
            !CryptoUtils.isException(blocks[0].data.id)
        ) {
            // Discard remaining blocks as it won't go anywhere anyway.
            this.clearQueue();
            this.resetLastDownloadedBlock();
            return callback();
        }

        let forkBlock: Interfaces.IBlock | undefined = undefined;
        for (const block of blocks) {
            lastProcessResult = await this.blockProcessor.process(block);

            if (lastProcessResult === BlockProcessorResult.Accepted) {
                acceptedBlocks.push(block);
            } else {
                if (lastProcessResult === BlockProcessorResult.Rollback) {
                    forkBlock = block;
                }
                break; // if one block is not accepted, the other ones won't be chained anyway
            }
        }

        if (acceptedBlocks.length > 0) {
            try {
                await this.blockRepository.saveBlocks(acceptedBlocks);
            } catch (error) {
                this.app.log.error(`Could not save ${acceptedBlocks.length} blocks to database : ${error.stack}`);

                this.clearQueue();

                // Rounds are saved while blocks are being processed and may now be out of sync with the last
                // block that was written into the database.

                const lastBlock: Interfaces.IBlock = await this.database.getLastBlock();
                const lastHeight: number = lastBlock.data.height;
                const deleteRoundsAfter: number = Utils.roundCalculator.calculateRound(lastHeight).round;

                this.app.log.info(
                    `Reverting ${Utils.pluralize(
                        "block",
                        acceptedBlocks.length,
                        true,
                    )} back to last height: ${lastHeight}`,
                );

                for (const block of acceptedBlocks.reverse()) {
                    await this.database.revertBlock(block);
                }

                this.state.setLastBlock(lastBlock);
                this.resetLastDownloadedBlock();

                await this.database.deleteRound(deleteRoundsAfter + 1);
                await this.database.loadBlocksFromCurrentRound();

                return callback();
            }
        }

        if (
            lastProcessResult === BlockProcessorResult.Accepted ||
            lastProcessResult === BlockProcessorResult.DiscardedButCanBeBroadcasted
        ) {
            const currentBlock: Interfaces.IBlock = blocks[blocks.length - 1];
            const blocktime: number = Managers.configManager.getMilestone(currentBlock.data.height).blocktime;

            if (this.state.started && Crypto.Slots.getSlotNumber() * blocktime <= currentBlock.data.timestamp) {
                this.app
                    .get<Contracts.P2P.INetworkMonitor>(Container.Identifiers.PeerNetworkMonitor)
                    .broadcastBlock(currentBlock);
            }
        } else if (forkBlock) {
            this.forkBlock(forkBlock)
        }

        return callback(acceptedBlocks);
    }

    /**
     * Reset the last downloaded block to last chained block.
     */
    public resetLastDownloadedBlock(): void {
        this.state.lastDownloadedBlock = this.getLastBlock().data;
    }

    /**
     * Called by forger to wake up and sync with the network.
     * It clears the wakeUpTimeout if set.
     */
    public forceWakeup(): void {
        this.state.clearWakeUpTimeout();

        this.dispatch("WAKEUP");
    }

    /**
     * Fork the chain at the given block.
     */
    public forkBlock(block: Interfaces.IBlock, numberOfBlockToRollback?: number): void {
        this.state.forkedBlock = block;

        if (numberOfBlockToRollback) {
            this.state.numberOfBlocksToRollback = numberOfBlockToRollback;
        }

        this.dispatch("FORK");
    }

    /**
     * Determine if the blockchain is synced.
     */
    public isSynced(block?: Interfaces.IBlockData): boolean {
        if (!this.app.get<Contracts.P2P.PeerStorage>(Container.Identifiers.PeerStorage).hasPeers()) {
            return true;
        }

        block = block || this.getLastBlock().data;

        return (
            Crypto.Slots.getTime() - block.timestamp < 3 * Managers.configManager.getMilestone(block.height).blocktime
        );
    }

    public async replay(targetHeight?: number): Promise<void> {
        return;
    }

    /**
     * Get the last block of the blockchain.
     */
    public getLastBlock(): Interfaces.IBlock {
        return this.state.getLastBlock();
    }

    /**
     * Get the last height of the blockchain.
     */
    public getLastHeight(): number {
        return this.getLastBlock().data.height;
    }

    /**
     * Get the last downloaded block of the blockchain.
     */
    public getLastDownloadedBlock(): Interfaces.IBlockData {
        return this.state.lastDownloadedBlock || this.getLastBlock().data;
    }

    /**
     * Get the block ping.
     */
    public getBlockPing(): {
        count: number;
        first: number;
        last: number;
        block: Interfaces.IBlockData;
    } {
        return this.state.blockPing;
    }

    /**
     * Ping a block.
     */
    public pingBlock(incomingBlock: Interfaces.IBlockData): boolean {
        return this.state.pingBlock(incomingBlock);
    }

    /**
     * Push ping block.
     */
    public pushPingBlock(block: Interfaces.IBlockData, fromForger = false): void {
        this.state.pushPingBlock(block, fromForger);
    }
}
