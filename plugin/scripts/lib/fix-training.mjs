// @ts-check
/** @import { TrainFile } from "./training.mjs" */
/** @typedef {{ fix_attempts: number, flaky_repeats: number, pr: string }} FixTraining */
/** @param {TrainFile | null} file @returns {FixTraining} */
export function fixTraining(file) {
  const data = file?.data ?? {};
  return { fix_attempts: Number(data.fix_attempts ?? 3), flaky_repeats: Number(data.flaky_repeats ?? 5), pr: String(data.pr ?? 'on-request') };
}

