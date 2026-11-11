import { requirementLabels } from './requirement-labels.ts';

describe('requirementLabels', () => {
  describe('when given an exact known key', () => {
    it('returns its friendly label', () => {
      expect(requirementLabels(['external_account', 'business_profile.url'])).toEqual([
        'Bank account or debit card',
        'Website',
      ]);
    });
  });

  describe.each([
    ['individual.dob.day', 'Date of birth'],
    ['individual.address.line1', 'Address'],
    ['individual.verification.document', 'Identity verification'],
    ['individual.first_name', 'Legal name'],
    ['tos_acceptance.date', 'Acceptance of Stripe terms'],
    ['business_profile.support_email', 'Business details'],
    ['company.tax_id', 'Business details'],
    ['representative.first_name', 'Business representative details'],
    ['person_abc123.verification.document', 'Business representative details'],
  ])('when given the prefixed key %s', (key, label) => {
    it('groups it under the prefix label', () => {
      expect(requirementLabels([key])).toEqual([label]);
    });
  });

  describe.each([
    ['business_type', 'Business type'],
    ['individual.id_number', 'Government ID number'],
    ['individual.ssn_last_4', 'Government ID number'],
  ])('when given the key %s', (key, label) => {
    it('returns its label', () => {
      expect(requirementLabels([key])).toEqual([label]);
    });
  });

  describe('when given an unknown key', () => {
    it('returns the generic label', () => {
      expect(requirementLabels(['something.new'])).toEqual(['Additional information']);
    });
  });

  describe('when several keys share a label', () => {
    it('lists the label once in first-seen order', () => {
      expect(
        requirementLabels(['individual.dob.day', 'external_account', 'individual.dob.month', 'individual.dob.year']),
      ).toEqual(['Date of birth', 'Bank account or debit card']);
    });
  });

  describe('when given no keys', () => {
    it('returns an empty list', () => {
      expect(requirementLabels([])).toEqual([]);
    });
  });
});
