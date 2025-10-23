import { API_CONFIG } from "./apiConfig";

type MessageCallback = (data: any) => void;

const WS_BASE = API_CONFIG.MAIN_URL;

class WsRobotService {
  private ws: WebSocket | null = null;
  private onMessage: MessageCallback | null = null;
  private connected = false;
  private helloSent = false;

  /** Convert http://... to ws://.../ws */
  private makeUrl(): string {
    return WS_BASE.replace(/^http/, "ws") + "/ws";
  }

  /** Public connection state */
  isConnected() {
    return this.connected;
  }

  /** Connect to backend WebSocket server */
  connect(onMessage: MessageCallback) {
    if (this.ws && this.connected) return;

    const url = this.makeUrl();
    console.log("[RobotWS] Connecting to:", url);

    this.ws = new WebSocket(url);
    this.onMessage = onMessage;

    this.ws.onopen = () => {
      this.connected = true;
      this.helloSent = false;
      console.log("[RobotWS] Connected.");
      this.sendControllerConnected(); // send after WS is ready
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage?.(data);
      } catch {
        console.warn("[RobotWS] Non-JSON message:", event.data);
      }
    };

    this.ws.onclose = (e) => {
      console.warn("[RobotWS] Closed:", e?.reason);
      this.connected = false;
      this.ws = null;
      this.helloSent = false;
    };

    this.ws.onerror = (err) => {
      console.error("[RobotWS] Error:", err);
      this.connected = false;
      this.helloSent = false;
    };
  }

  /** Send any JSON object */
  private sendRaw(obj: Record<string, any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    } else {
      console.warn("[RobotWS] Not connected, cannot send:", obj);
    }
  }

  /** Send sequence message like {"type": "sequence", "seq": "1,3"} */
  sendSequence(seq: string) {
    const payload = { type: "sequence", seq };
    console.log("[RobotWS] Sending:", payload);
    this.sendRaw(payload);
  }

  /** Announce controller presence; idempotent per connection */
  sendControllerConnected() {
    if (this.helloSent) return;
    const payload = { type: "controller", status: "connected" };
    console.log("[RobotWS] Sending:", payload);
    this.sendRaw(payload);
    this.helloSent = true;
  }

  /** Close socket */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.helloSent = false;
    }
  }
}

export default new WsRobotService();
