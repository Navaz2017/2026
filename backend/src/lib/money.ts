// Integer minor-unit money maths. Basis points: 3000 = 30%.
export interface FeeSplit {
  feeMinor: number; // institution's listed application fee
  studentServiceFeeMinor: number; // extra charged to student
  totalDueMinor: number; // what the student pays
  commissionMinor: number; // owner share taken from the institution
  institutionNetMinor: number; // owed to the institution at month end
  ownerRevenueMinor: number; // commission + student service fee
}

const bps = (amount: number, rate: number) => Math.round((amount * rate) / 10_000);

export function splitFee(feeMinor: number, institutionCommissionBps: number, studentServiceFeeBps: number): FeeSplit {
  if (!Number.isInteger(feeMinor) || feeMinor < 0) throw new Error("fee must be a non-negative integer");
  for (const r of [institutionCommissionBps, studentServiceFeeBps]) {
    if (!Number.isInteger(r) || r < 0 || r > 10_000) throw new Error("rate must be 0..10000 bps");
  }
  const studentServiceFeeMinor = bps(feeMinor, studentServiceFeeBps);
  const commissionMinor = bps(feeMinor, institutionCommissionBps);
  return {
    feeMinor,
    studentServiceFeeMinor,
    totalDueMinor: feeMinor + studentServiceFeeMinor,
    commissionMinor,
    institutionNetMinor: feeMinor - commissionMinor,
    ownerRevenueMinor: commissionMinor + studentServiceFeeMinor,
  };
}
