const AUTOMOTIVE_OR_CONSUMER_BATTERY =
  /\b(?:tesla|model\s+[23sxy]|electric\s+vehicle|\bev\b|mile(?:s)?\s+range|battery\s+range|range\s+on\s+a\s+charge)\b/i;

const HARDWARE_PRODUCT_SIGNAL =
  /\b(?:hardware|sensor|sensors|temperature|humidity|humid(?:ity)?|thermostat|mcu|esp32|arduino|stm32|pcb|pcba|bom|bill of materials|enclosure|casing|wall[-\s]?mount|touchscreen|firmware|i2c|spi|sht(?:3x|4x|40|45)?|dht22|aht20|mqtt|lora|(?:^|[^a-z])battery(?!.{0,24}\brange\b)|batteries|wiring|solder|soldering|buck converter|calibration|ce marking|fcc|ip\d{2}|injection mold|3d[-\s]?print|jlcpcb|lcsc|aliexpress|mouser|digikey|digi-key)\b/i;

const PRODUCT_RESEARCH_SIGNAL =
  /\b(?:product for sale|sellable|manufacturing|supplier|suppliers|sourcing|procurement|moq|lead time|unit cost|cogs|pilot|field test|certification|regulatory|industrial design|mechanical design|saas|admin dashboard|alerts?|fleet|telemetry|monitoring|roadmap|mvp|go[-\s]?to[-\s]?market)\b/i;

const SOFTWARE_EXECUTION_ANCHOR =
  /\b(?:prototype|scaffold|build|create|generate|implement|code|make)\b.{0,80}\b(?:web\s+dashboard|dashboard\s+ui|ui prototype|frontend|react|next(?:\.js)?|vite|tailwind|app files|source files|package\.json|firmware code|arduino sketch|esp32 code|lvgl code|runnable|preview|sandbox)\b/i;

const FILE_OR_STACK_ANCHOR =
  /(?:\b[\w./-]+\.(?:tsx|ts|jsx|js|css|json|html|ino|cpp|c|h|py)\b|title=["'][^"']+["']|```[a-z0-9+#.-]*\s+title=|\b(?:react|next(?:\.js)?|vite|tailwind|typescript|fastapi|express|arduino ide|platformio)\b)/i;

export function hasProductEngineeringSignal(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (AUTOMOTIVE_OR_CONSUMER_BATTERY.test(text)) return false;
  const hasHardwareSignal = HARDWARE_PRODUCT_SIGNAL.test(text);
  // Temperature/humidity alone are ambiguous: they commonly appear in
  // weather and measurement questions. Require a physical-device/product
  // co-signal before the full hardware-product memo may take the turn.
  const hasUnambiguousHardwareSignal = /\b(?:hardware|sensors?|thermostat|mcu|esp32|arduino|stm32|pcb|pcba|bom|bill of materials|enclosure|casing|wall[-\s]?mount|touchscreen|firmware|i2c|spi|sht(?:3x|4x|40|45)?|dht22|aht20|mqtt|lora|batteries|wiring|solder|buck converter|calibration|ce marking|fcc|injection mold|3d[-\s]?print|jlcpcb|lcsc|aliexpress|mouser|digikey|digi-key)\b/i.test(text);
  return (hasHardwareSignal && hasUnambiguousHardwareSignal) || (
    PRODUCT_RESEARCH_SIGNAL.test(text)
    && /\b(?:hardware|device|sensor|physical|wall|enclosure|firmware|pcb|manufacturing|sourcing|product)\b/i.test(text)
  );
}

export function hasExplicitSoftwareExecutionAnchor(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return SOFTWARE_EXECUTION_ANCHOR.test(text) || FILE_OR_STACK_ANCHOR.test(text);
}

export function hasExplicitSoftwareBuildRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return SOFTWARE_EXECUTION_ANCHOR.test(text);
}

/**
 * Formal-logic / rule-inference prompts mention devices ("the sensor trips",
 * "the alarm rings") as abstract propositions, not as products to build.
 * A stated rule plus an inference question must never route to the memo.
 */
const RULE_INFERENCE_PROMPT =
  /\brule\s*:|\bbased\s+(?:only\s+)?on\s+the\s+rule\b|\bcan\s+we\s+conclude\b|\banswer\s+yes\s+or\s+no\b/i;

export function isProductEngineeringPlanningPrompt(input: string): boolean {
  if (RULE_INFERENCE_PROMPT.test(input)) return false;
  return hasProductEngineeringSignal(input) && !hasExplicitSoftwareExecutionAnchor(input);
}
