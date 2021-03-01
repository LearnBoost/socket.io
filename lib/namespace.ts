import { Socket } from "./socket";
import type {
  DefaultEventsMap,
  EventParams,
  EventNames,
  EventsMap,
  Server,
} from "./index";
import type { Client } from "./client";
import { EventEmitter } from "events";
import debugModule from "debug";
import type { Adapter, Room, SocketId } from "socket.io-adapter";
import { BroadcastOperator, RemoteSocket } from "./broadcast-operator";

const debug = debugModule("socket.io:namespace");

export interface ExtendedError extends Error {
  data?: any;
}

export class Namespace<
  UserEvents extends EventsMap = DefaultEventsMap,
  UserEmitEvents extends EventsMap = UserEvents
> extends EventEmitter {
  public readonly name: string;
  public readonly sockets: Map<SocketId, Socket> = new Map();

  public adapter: Adapter;

  /** @private */
  readonly server: Server<UserEvents, UserEmitEvents>;

  /** @private */
  _fns: Array<
    (socket: Socket, next: (err?: ExtendedError) => void) => void
  > = [];

  /** @private */
  _ids: number = 0;

  /**
   * Namespace constructor.
   *
   * @param server instance
   * @param name
   */
  constructor(server: Server<UserEvents, UserEmitEvents>, name: string) {
    super();
    this.server = server;
    this.name = name;
    this._initAdapter();
  }

  /**
   * Initializes the `Adapter` for this nsp.
   * Run upon changing adapter by `Server#adapter`
   * in addition to the constructor.
   *
   * @private
   */
  _initAdapter(): void {
    this.adapter = new (this.server.adapter()!)(this);
  }

  /**
   * Sets up namespace middleware.
   *
   * @return self
   * @public
   */
  public use(
    fn: (socket: Socket, next: (err?: ExtendedError) => void) => void
  ): this {
    this._fns.push(fn);
    return this;
  }

  /**
   * Executes the middleware for an incoming client.
   *
   * @param socket - the socket that will get added
   * @param fn - last fn call in the middleware
   * @private
   */
  private run(socket: Socket, fn: (err: ExtendedError | null) => void) {
    const fns = this._fns.slice(0);
    if (!fns.length) return fn(null);

    function run(i: number) {
      fns[i](socket, function (err) {
        // upon error, short-circuit
        if (err) return fn(err);

        // if no middleware left, summon callback
        if (!fns[i + 1]) return fn(null);

        // go on to next
        run(i + 1);
      });
    }

    run(0);
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   * @public
   */
  public to(
    room: Room | Room[]
  ): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).to(room);
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   * @public
   */
  public in(
    room: Room | Room[]
  ): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).in(room);
  }

  /**
   * Excludes a room when emitting.
   *
   * @param room
   * @return self
   * @public
   */
  public except(
    room: Room | Room[]
  ): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).except(room);
  }

  /**
   * Adds a new client.
   *
   * @return {Socket}
   * @private
   */
  _add(
    client: Client<UserEvents, UserEmitEvents>,
    query,
    fn?: () => void
  ): Socket {
    debug("adding socket to nsp %s", this.name);
    const socket = new Socket(this, client, query);
    this.run(socket, (err) => {
      process.nextTick(() => {
        if ("open" == client.conn.readyState) {
          if (err) {
            if (client.conn.protocol === 3) {
              return socket._error(err.data || err.message);
            } else {
              return socket._error({
                message: err.message,
                data: err.data,
              });
            }
          }

          // track socket
          this.sockets.set(socket.id, socket);

          // it's paramount that the internal `onconnect` logic
          // fires before user-set events to prevent state order
          // violations (such as a disconnection before the connection
          // logic is complete)
          socket._onconnect();
          if (fn) fn();

          // fire user-set events
          super.emit("connect", socket);
          super.emit("connection", socket);
        } else {
          debug("next called after client was closed - ignoring socket");
        }
      });
    });
    return socket;
  }

  /**
   * Removes a client. Called by each `Socket`.
   *
   * @private
   */
  _remove(socket: Socket): void {
    if (this.sockets.has(socket.id)) {
      this.sockets.delete(socket.id);
    } else {
      debug("ignoring remove for %s", socket.id);
    }
  }

  /**
   * Emits to all clients.
   *
   * @return Always true
   * @public
   */
  public emit<Ev extends EventNames<UserEmitEvents>>(
    ev: Ev,
    ...args: EventParams<UserEmitEvents, Ev>
  ): true {
    return new BroadcastOperator<UserEvents, UserEmitEvents>(this.adapter).emit(
      ev,
      ...args
    );
  }

  /**
   * Sends a `message` event to all clients.
   *
   * @return self
   * @public
   */
  public send(...args: EventParams<UserEmitEvents, "message">): this {
    this.emit("message", ...args);
    return this;
  }

  /**
   * Sends a `message` event to all clients.
   *
   * @return self
   * @public
   */
  public write(...args: EventParams<UserEmitEvents, "message">): this {
    this.emit("message", ...args);
    return this;
  }

  /**
   * Gets a list of clients.
   *
   * @return self
   * @public
   */
  public allSockets(): Promise<Set<SocketId>> {
    return new BroadcastOperator(this.adapter).allSockets();
  }

  /**
   * Sets the compress flag.
   *
   * @param compress - if `true`, compresses the sending data
   * @return self
   * @public
   */
  public compress(
    compress: boolean
  ): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).compress(compress);
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return self
   * @public
   */
  public get volatile(): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).volatile;
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
   *
   * @return self
   * @public
   */
  public get local(): BroadcastOperator<UserEvents, UserEmitEvents> {
    return new BroadcastOperator(this.adapter).local;
  }

  /**
   * Returns the matching socket instances
   *
   * @public
   */
  public fetchSockets(): Promise<RemoteSocket<UserEvents, UserEmitEvents>[]> {
    return new BroadcastOperator(this.adapter).fetchSockets();
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param room
   * @public
   */
  public socketsJoin(room: Room | Room[]): void {
    return new BroadcastOperator(this.adapter).socketsJoin(room);
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param room
   * @public
   */
  public socketsLeave(room: Room | Room[]): void {
    return new BroadcastOperator(this.adapter).socketsLeave(room);
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param close - whether to close the underlying connection
   * @public
   */
  public disconnectSockets(close: boolean = false): void {
    return new BroadcastOperator(this.adapter).disconnectSockets(close);
  }
}
