/**
 * Employees: who is signed in, the list the owner manages, and the add/edit form.
 */
export interface StaffInfo {
  username: string;
  name: string;
  role: string;
  /** The owner account itself. */
  owner: boolean;
  /** Signed in to an employee's account with the owner's password. */
  viaOwner: boolean;
}

/** An employee as the owner sees them. The password is never sent anywhere. */
export interface StaffMember {
  username: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface StaffSaveInput {
  username: string;
  name: string;
  role: string;
  active: boolean;
  /** Required for a new employee; for an existing one it sets a new password. */
  password: string;
}
