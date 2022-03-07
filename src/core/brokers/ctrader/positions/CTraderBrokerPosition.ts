import {
    GenericObject, MidaBrokerOrder,
    MidaBrokerPosition,
    MidaBrokerPositionProtection,
    MidaBrokerPositionStatus,
} from "@reiryoku/mida";
import { CTraderBrokerPositionParameters } from "#brokers/ctrader/positions/CTraderBrokerPositionParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerPosition extends MidaBrokerPosition {
    readonly #connection: CTraderConnection;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;

    public constructor ({
        id,
        orders,
        protection,
        connection,
    }: CTraderBrokerPositionParameters) {
        super({
            id,
            orders,
            protection,
        });

        this.#connection = connection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;

        this.#configureListeners();
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let usedMargin: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                usedMargin += Number(plainOpenPosition.usedMargin);
            }
        }

        return usedMargin / 100;
    }

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let swap: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                swap += Number(plainOpenPosition.swap);
            }
        }

        return swap / 100;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let commission: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                commission += Number(plainOpenPosition.commission);
            }
        }

        return commission / 100;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let unrealizedGrossProfit: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                unrealizedGrossProfit += await this.#cTraderBrokerAccount.getPlainPositionGrossProfit(plainOpenPosition);
            }
        }

        return unrealizedGrossProfit / 100;
    }

    public override async modifyProtection (protection: MidaBrokerPositionProtection): Promise<void> {
        const requestDescriptor: GenericObject = {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            positionId: this.id,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingStopLoss: this.trailingStopLoss,
        };

        if ("stopLoss" in protection) {
            requestDescriptor.stopLoss = protection.stopLoss;
        }

        if ("takeProfit" in protection) {
            requestDescriptor.takeProfit = protection.takeProfit;
        }

        if ("trailingStopLoss" in protection) {
            requestDescriptor.trailingStopLoss = protection.trailingStopLoss;
        }

        this.#connection.sendCommand("ProtoOAAmendPositionSLTPReq", requestDescriptor);
    }

    public override async setStopLoss (stopLoss: number): Promise<void> {
        await this.modifyProtection({ stopLoss, });
    }

    public override async setTakeProfit (takeProfit: number): Promise<void> {
        await this.modifyProtection({ takeProfit, });
    }

    public override async setTrailingStopLoss (trailingStopLoss:boolean): Promise<void> {
        await this.modifyProtection({ trailingStopLoss, });
    }

    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        const plainOrder: GenericObject = descriptor.order;
        const positionId: string = plainOrder?.positionId?.toString();

        if (positionId && positionId === this.id) {
            // Used to associate the order to the actual position
            if (!this.#hasOrder(plainOrder.orderId.toString())) {
                this.onOrder(await this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder));
            }

            switch (descriptor.executionType) {
                case "SWAP": {
                    // TODO: pass the real quantity
                    this.onSwap(NaN);

                    break;
                }
                case "ORDER_REPLACED": {
                    this.onProtectionChange(this.#cTraderBrokerAccount.normalizePlainPositionProtection(descriptor.position));

                    break;
                }
                case "ORDER_FILLED":
                case "ORDER_PARTIAL_FILL": {
                    this.onOrderFill(await this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder));

                    break;
                }
            }
        }

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor);
        }
        else if (this.status === MidaBrokerPositionStatus.CLOSED && this.#updateEventUuid) {
            this.#connection.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }
    }

    #configureListeners (): void {
        this.#updateEventUuid = this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onUpdate(descriptor);
            }
        });
    }

    #hasOrder (id: string): boolean {
        for (const order of this.orders) {
            if (order.id === id) {
                return true;
            }
        }

        return false;
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}
