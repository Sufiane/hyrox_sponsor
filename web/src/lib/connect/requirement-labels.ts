const EXACT_LABELS: Record<string, string> = {
  external_account: 'Bank account or debit card',
  'individual.id_number': 'Government ID number',
  'individual.ssn_last_4': 'Government ID number',
  business_type: 'Business type',
  'individual.email': 'Email address',
  'individual.phone': 'Phone number',
  'business_profile.url': 'Website',
  'business_profile.mcc': 'Business category',
  'business_profile.product_description': 'Business description',
};

const PREFIX_LABELS: Array<[string, string]> = [
  ['individual.dob.', 'Date of birth'],
  ['individual.address.', 'Address'],
  ['individual.verification.', 'Identity verification'],
  ['individual.first_name', 'Legal name'],
  ['individual.last_name', 'Legal name'],
  ['tos_acceptance.', 'Acceptance of Stripe terms'],
  ['business_profile.', 'Business details'],
  ['company.', 'Business details'],
  ['representative.', 'Business representative details'],
  ['person_', 'Business representative details'],
];

const FALLBACK_LABEL = 'Additional information';

function labelFor(key: string): string {
  const exact = EXACT_LABELS[key];

  if (exact != null) {
    return exact;
  }

  const prefix = PREFIX_LABELS.find(([start]) => key.startsWith(start));

  return prefix != null ? prefix[1] : FALLBACK_LABEL;
}

export function requirementLabels(keys: readonly string[]): string[] {
  return [...new Set(keys.map(labelFor))];
}
