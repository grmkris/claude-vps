export function describeCron(schedule: string): string {
  const parts = schedule.split(" ");
  if (parts.length !== 5) return schedule;

  const [minute, hour, dayMonth, month, dayWeek] = parts;

  if (schedule === "* * * * *") return "Every minute";
  if (schedule === "0 * * * *") return "Every hour";
  if (schedule === "0 0 * * *") return "Daily at midnight";
  if (minute?.startsWith("*/")) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }
  if (hour?.startsWith("*/")) {
    const interval = hour.slice(2);
    return `Every ${interval} hours`;
  }
  if (dayWeek === "1-5" && minute !== "*" && hour !== "*") {
    return `Weekdays at ${hour}:${minute?.padStart(2, "0")}`;
  }
  if (dayMonth !== "*" || month !== "*") {
    return schedule;
  }
  if (dayWeek !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = days[Number.parseInt(dayWeek)] ?? dayWeek;
    return `${dayName} at ${hour}:${minute?.padStart(2, "0")}`;
  }
  if (hour !== "*" && minute !== "*") {
    return `Daily at ${hour}:${minute?.padStart(2, "0")}`;
  }

  return schedule;
}
