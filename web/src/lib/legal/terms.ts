export interface TosSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export const TOS_TITLE = 'Terms of Service';

export const TOS_DRAFT_NOTICE: string | null =
  'DRAFT - not legal advice. Placeholder terms pending review.';

export const TOS_SECTIONS: TosSection[] = [
  {
    id: 'about',
    heading: 'About the service',
    paragraphs: [
      'This site is a marketplace that connects athletes who offer body-zone sponsorship space with sponsors who bid for it.',
      'By using the site or creating an account you agree to these terms.',
    ],
  },
  {
    id: 'eligibility',
    heading: 'Eligibility',
    paragraphs: [
      'You must be 18 or older to create an account. Creating an account is your attestation that you meet this requirement.',
      'We may remove accounts that belong to minors.',
    ],
  },
  {
    id: 'accounts',
    heading: 'Your account',
    paragraphs: [
      'Give accurate information and keep your credentials secret. One person per account.',
      'You are responsible for all activity on your account.',
    ],
  },
  {
    id: 'trademark',
    heading: 'HYROX trademark',
    paragraphs: [
      'This platform is independent. It is not affiliated with, endorsed or sponsored by HYROX or its organisers.',
      'HYROX is a trademark of its owner and is used here only to identify events.',
    ],
  },
  {
    id: 'auctions',
    heading: 'Auctions',
    paragraphs: [
      'Athletes list body zones (for example chest or forearm) for a race with a floor price. Sponsors bid in a time-limited auction, and the highest valid bid at close wins.',
      'A sale only grants the right to display the sponsor during the stated race, subject to event rules.',
    ],
  },
  {
    id: 'bids',
    heading: 'Bids',
    paragraphs: [
      'A bid is a binding offer. It cannot be withdrawn once placed, except as the platform allows.',
      'The winning bidder must pay.',
    ],
  },
  {
    id: 'payments',
    heading: 'Payments and escrow',
    paragraphs: [
      'Payments are processed through a third-party processor and held in escrow until proof of sponsorship is accepted.',
      'Refunds are described at checkout and apply where sponsorship is not delivered. Processor fees and taxes may apply.',
    ],
  },
  {
    id: 'obligations',
    heading: 'Athlete and sponsor obligations',
    paragraphs: [
      'Athletes must display the sponsor as agreed and submit proof. Sponsors must supply lawful content.',
      'The platform may reject proof, issue strikes or ban accounts for breaches.',
    ],
  },
  {
    id: 'disputes',
    heading: 'Disputes',
    paragraphs: [
      'Raise disputes through the platform within the stated period. The platform may review proof and decide the escrow outcome.',
      'Governing law and venue are to be set.',
    ],
  },
  {
    id: 'liability',
    heading: 'Liability',
    paragraphs: [
      'The service is provided as is. To the extent permitted by law, we are not liable for race outcomes, injury, event rule decisions by organisers, or indirect losses.',
      'Nothing here excludes liability that cannot be excluded.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    paragraphs: [
      'These terms may change. The version in force is shown on this page.',
      'Continued use after notice of a change means you accept it.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact',
    paragraphs: ['[contact email to be set]'],
  },
];
