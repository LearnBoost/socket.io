"use strict";
import { DefaultEventsMap, Server, Socket } from "..";
import { createServer } from "http";
import { expectError, expectType } from "tsd";
import "./support/util";

describe("server", () => {
  describe("no event map", () => {
    describe("on", () => {
      it("infers correct types for listener parameters of reserved events", (done) => {
        const srv = createServer();
        const sio = new Server(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectType<Socket<DefaultEventsMap, DefaultEventsMap>>(s);
            s.on("disconnect", (reason) => {
              expectType<string>(reason);
            });
            s.on("disconnecting", (reason) => {
              expectType<string>(reason);
            });
          });
          sio.on("connect", (s) => {
            expectType<Socket<DefaultEventsMap, DefaultEventsMap>>(s);
          });
          done();
        });
      });

      it("infers 'any' for listener parameters of other events", (done) => {
        const srv = createServer();
        const sio = new Server(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            s.on("random", (a, b, c) => {
              expectType<any>(a);
              expectType<any>(b);
              expectType<any>(c);
              done();
            });
            s.emit("random", 1, "2", [3]);
          });
        });
      });
    });

    describe("emit", () => {
      it("accepts any parameters", () => {
        const srv = createServer();
        const sio = new Server(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            s.emit("random", 1, "2", [3]);
            s.emit("no parameters");
          });
        });
      });
    });
  });

  describe("single event map", () => {
    interface BidirectionalEvents {
      random: (a: number, b: string, c: number[]) => void;
      noParameter: void;
      oneParameter: string;
      "complicated name with spaces": void;
    }

    describe("on", () => {
      it("infers correct types for listener parameters", (done) => {
        const srv = createServer();
        const sio = new Server<BidirectionalEvents>(srv);
        expectType<Server<BidirectionalEvents, BidirectionalEvents>>(sio);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectType<Socket<BidirectionalEvents, BidirectionalEvents>>(s);
            s.on("random", (a, b, c) => {
              expectType<number>(a);
              expectType<string>(b);
              expectType<number[]>(c);
              done();
            });
            s.on("complicated name with spaces", () => {});
            s.on("noParameter", () => {});
            s.on("oneParameter", (str) => {
              expectType<string>(str);
            });
          });
        });
      });

      it("does not accept arguments of wrong types", (done) => {
        const srv = createServer();
        const sio = new Server<BidirectionalEvents>(srv);
        srv.listen(() => {
          expectError(sio.on("wrong name", (s) => {}));
          sio.on("connection", (s) => {
            s.on("random", (a, b, c) => {});
            expectError(s.on("random"));
            expectError(s.on("random", (a, b, c, d) => {}));
            expectError(s.on("wrong name", () => {}));
            expectError(s.on("wrong name"));
            expectError(s.on("complicated name with spaces", (a) => {}));
            expectError(s.on(2, 3));
          });
        });
      });
    });

    describe("emit", () => {
      it("accepts arguments of the correct types", () => {
        const srv = createServer();
        const sio = new Server<BidirectionalEvents>(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            s.emit("noParameter");
            s.emit("oneParameter", "hi");
            s.emit("random", 1, "2", [3]);
            s.emit("complicated name with spaces");
          });
        });
      });

      it("does not accept arguments of the wrong types", () => {
        const srv = createServer();
        const sio = new Server<BidirectionalEvents>(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectError(s.emit("noParameter", 2));
            expectError(s.emit("oneParameter"));
            expectError(s.emit("random"));
            expectError(s.emit("oneParameter", 2, 3));
            expectError(s.emit("random", (a, b, c) => {}));
            expectError(s.emit("wrong name", () => {}));
            expectError(s.emit("complicated name with spaces", 2));
          });
        });
      });
    });
  });

  describe("listen and emit event maps", () => {
    interface ClientToServerEvents {
      helloFromClient: (message: string) => void;
    }

    interface ServerToClientEvents {
      helloFromServer: (message: string, x: number) => void;
    }

    describe("on", () => {
      it("infers correct types for listener parameters", (done) => {
        const srv = createServer();
        const sio = new Server<ClientToServerEvents, ServerToClientEvents>(srv);
        expectType<Server<ClientToServerEvents, ServerToClientEvents>>(sio);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectType<Socket<ClientToServerEvents, ServerToClientEvents>>(s);
            s.on("helloFromClient", (message) => {
              expectType<string>(message);
              done();
            });
          });
        });
      });

      it("does not accept emit events", (done) => {
        const srv = createServer();
        const sio = new Server<ClientToServerEvents, ServerToClientEvents>(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectError(
              s.on("helloFromServer", (message, number) => {
                done();
              })
            );
          });
        });
      });
    });

    describe("emit", () => {
      it("accepts arguments of the correct types", (done) => {
        const srv = createServer();
        const sio = new Server<ClientToServerEvents, ServerToClientEvents>(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            s.emit("helloFromServer", "hi", 10);
            done();
          });
        });
      });

      it("does not accept arguments of wrong types", (done) => {
        const srv = createServer();
        const sio = new Server<ClientToServerEvents, ServerToClientEvents>(srv);
        srv.listen(() => {
          sio.on("connection", (s) => {
            expectError(s.emit("helloFromClient", "hi"));
            expectError(s.emit("helloFromServer", "hi", 10, "10"));
            expectError(s.emit("helloFromServer", "hi", "10"));
            expectError(s.emit("helloFromServer", 0, 0));
            expectError(s.emit("wrong name", 10));
            expectError(s.emit("wrong name"));
            done();
          });
        });
      });
    });
  });
});
