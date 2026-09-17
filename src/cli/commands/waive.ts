import os from "node:os";

import { addWaiver } from "../../run/store.js";

export const waiveQuestion = (questionId: string, reason: string): string => {
  const waiver = addWaiver(os.homedir(), process.cwd(), {
    id: questionId,
    reason,
    by: os.userInfo().username,
  });
  return `Waived ${waiver.id}: ${waiver.reason} (${waiver.by}, ${waiver.at})`;
};
