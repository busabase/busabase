/** Private preview bridge messages; neither server output nor deployed-site logs. */
export const AIRAPP_BROWSER_CONSOLE_CHANNEL = "busabase-airapp-console";
export const AIRAPP_BROWSER_CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
export const AIRAPP_BROWSER_CONSOLE_MESSAGE_LIMIT = 8192;
export const AIRAPP_BROWSER_CONSOLE_ENTRY_LIMIT = 200;
