/**
 * A guest.
 */
export interface Guest {
  id: string;
  name: string;
  /** 10 digits, no country code. */
  mobile: string;
  email: string;
  idType: string;
  /** Only the last 4 digits of an ID are ever stored. */
  idLast4: string;
  city: string;
  createdAt: string;
}
