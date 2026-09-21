<script setup lang="ts">
import type { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { ORG_ROLE_LABEL_KEYS } from '~/utils/organizationRoles';

/**
 * Everyone who belongs to one organization, and their role.
 *
 * Presentational, for the reason `SessionList` gives: reading and changing a
 * role are `useMembers`'.
 *
 * ## The two controls are gated independently, and neither by a role read here
 *
 * `canChangeRole` and `canRemove` arrive as booleans the page already asked
 * `useCan` for (`member:update`, `member:remove`) — this component compares
 * neither role name against the other. Rendering a control this actor's own
 * request would be refused for is an affordance nobody could act on, not a
 * decision this component is making about what an `OrgRole` may do; that
 * decision is `can()`'s alone (ADR-0006).
 */
interface Props {
  /** The members to show. */
  members: readonly Membership[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
  /** Whether the actor may change a member's role. */
  canChangeRole?: boolean;
  /** Whether the actor may remove a member. */
  canRemove?: boolean;
}

withDefaults(defineProps<Props>(), {
  busy: false,
  canChangeRole: false,
  canRemove: false,
});

const emit = defineEmits<{
  /** Give this member a different role. The parent does it and re-reads the list. */
  updateRole: [userId: UserId, role: OrgRole];
  /** End this membership. The parent does it and re-reads the list. */
  remove: [userId: UserId];
}>();

const { t } = useI18n();

const ROLE_OPTIONS = Object.values(OrgRole).map((role) => ({
  value: role,
  label: t(ORG_ROLE_LABEL_KEYS[role]),
}));

function onRoleChange(userId: UserId, value: string): void {
  emit('updateRole', userId, value as OrgRole);
}
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('organizations.members.columnMember') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.members.columnRole') }}</AppTableCell>
      <AppTableCell header align="right">
        {{ t('organizations.members.columnActions') }}
      </AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="member in members" :key="member.id">
        <AppTableCell emphasis="primary">{{ member.userId }}</AppTableCell>
        <AppTableCell>
          <AppSelect
            v-if="canChangeRole"
            :model-value="member.role"
            :options="ROLE_OPTIONS"
            :disabled="busy"
            @update:model-value="onRoleChange(member.userId, $event)"
          />
          <span v-else>{{ t(ORG_ROLE_LABEL_KEYS[member.role]) }}</span>
        </AppTableCell>
        <AppTableCell align="right">
          <AppButton
            v-if="canRemove"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('remove', member.userId)"
          >
            {{ t('organizations.members.remove') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
