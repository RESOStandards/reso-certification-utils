// Dependency chains for reference-based key field generation
const RESO_KEY_DEPENDENCY_MAP = {
  Property: {
    ListAgentKey: 'TeamMembers(ListTeamKey:TeamKey).MemberKey',
    BuyerAgentKey: 'TeamMembers(BuyerTeamKey:TeamKey).MemberKey',
    CoBuyerOfficeKey: 'Member(CoBuyerAgentKey:MemberKey).OfficeKey',
    ListOfficeKey: 'Member(ListAgentKey:MemberKey).OfficeKey',
    CoListOfficeKey: 'Member(CoListAgentKey:MemberKey).OfficeKey'
  },
  // TODO: These and other depdendent keys may end up as null in the first batch
  Office: {
    OfficeBrokerKey: 'Member(OfficeKey:OfficeKey).MemberKey',
    OfficeManagerKey: 'Member(OfficeKey:OfficeKey).MemberKey'
  },
  Showing: {},
  TeamMembers: {
    TeamKey: 'Teams.TeamKey'
  }
};

// For each resource below, if present in the metadata, `true` should have their entities generated at the top level, and `false` should
// be generated within a parent record as part of an expansion
const TOP_LEVEL_RESOURCE_MAP = {
  OUID: true,
  Office: true,
  Member: true,
  Teams: true,
  TeamMembers: true,
  Contacts: true,
  Property: true,
  ContactListings: true,
  SvaedSearch: true,
  Prospecting: true,
  Queue: true,
  Showing: true,
  Rules: true,
  Field: true,
  Lookup: true,
  Media: false,
  PropertyGreenVerification: false,
  PropertyRooms: false,
  PropertyPowerProduction: false,
  HistoryTransactional: false,
  PropertyUnitTypes: false,
  SocialMedia: false,
  OpenHouse: false,
  OtherPhone: false,
  ContactListingNotes: false
};

// Known suffixes of alternate (duplicate) keys
const ALTERNATE_KEY_SUFFIXES = ['KeyNumeric'];

// Map of primary keys for RESO resources which are not of the format `{resource name}Key`
const PRIMARY_KEY_MAP = {
  OUID: 'OrganizationUniqueIdKey',
  Contacts: 'ContactKey',
  InternetTracking: 'ObjectKey',
  Queue: 'QueueTransactionKey',
  Teams: 'TeamKey',
  TeamMembers: 'TeamMemberKey',
  PropertyPowerProduction: 'PowerProductionKey',
  PropertyUnitTypes: 'UnitTypeKey',
  PropertyRooms: 'RoomKey',
  PropertyGreenVerficiation: 'GreenBuildingVerificationKey',
  Rules: 'RuleKey',
  Property: 'ListingKey'
};

const ENABLE_NESTED_EXPANSIONS = false;

module.exports = {
  ALTERNATE_KEY_SUFFIXES,
  ENABLE_NESTED_EXPANSIONS,
  PRIMARY_KEY_MAP,
  RESO_KEY_DEPENDENCY_MAP,
  TOP_LEVEL_RESOURCE_MAP
};
