import type { Generated } from 'kysely';

export interface FacilityTable {
  id: Generated<string>;
  code: string;
  name: string;
  timezone: string;
  is_synthetic: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DatabaseSchema {
  facilities: FacilityTable;
}
