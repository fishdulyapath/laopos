const BANGKOK_TIME_ZONE = "Asia/Bangkok";

const bangkokFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANGKOK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function partsForBangkok(date = new Date()) {
  const parts = {};
  for (const part of bangkokFormatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

function bangkokTimestamp(date = new Date()) {
  const parts = partsForBangkok(date);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}`;
}

module.exports = {
  BANGKOK_TIME_ZONE,
  bangkokTimestamp,
};
