export const API_CONFIG = {
  MAIN_URL: "http://192.168.0.229:8080",
  BASE_URL: "http://192.168.0.229:8080/api", // change to your backend
  ENDPOINTS: {
    MOVE_SEQUENCE: "/move-sequence",
    ROBOT_POSITIONS: "/robot-positions",
    CURRENT: "/current",
  },
  HEADERS: {
    "Content-Type": "application/json",
  },
};
