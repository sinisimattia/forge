<script setup lang="ts">
import {
  InvitationAddressMismatchError,
  InvitationNoLongerOpenError,
  InvitationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';

/**
 * Redeeming an invitation: the one screen an invited person reaches by a
 * link, not by navigating in.
 *
 * **No `permission` middleware, and that is not an oversight.** Every
 * organization-scoped permission this
 * application has is a question about a membership the actor already
 * holds — `can()`'s layer two, `ROLE_PERMISSIONS` — and accepting an
 * invitation is the one act that exists *because* the actor does not have
 * one yet. There is no `organizationId` here for the middleware to read
 * even if it were declared: the route names a token, not an organization,
 * on purpose (`postAcceptInvitation`'s own TSDoc — the backend must not be
 * told which organization issued a token before it has checked whether the
 * token still redeems anything). What actually authorizes this act is the
 * token itself, checked server-side against the signed-in address at
 * redemption (`InvitationAddressMismatchError`) — a proof `can()` was never
 * going to be asked to make, since `Permission` has no member for "holds an
 * unredeemed invitation".
 *
 * `auth` alone: the actor must be signed in, with the address the
 * invitation was sent to, for the mismatch check to have anyone to compare
 * against.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const route = useRoute();
const token = route.params.token as string;

const { acceptInvitation } = useOrganization();
const { t } = useI18n();

useHead({ title: t('organizations.acceptInvitation.title') });

const pending = ref(false);
const accepted = ref(false);
const errorKey = ref('');

async function accept(): Promise<void> {
  pending.value = true;
  errorKey.value = '';
  try {
    const membership = await acceptInvitation(token);
    accepted.value = true;
    await navigateTo(`/organizations/${membership.organizationId}/members`);
  } catch (error) {
    if (error instanceof InvitationNotFoundError) errorKey.value = 'organizations.acceptInvitation.notFound';
    else if (error instanceof InvitationNoLongerOpenError) {
      errorKey.value = 'organizations.acceptInvitation.noLongerOpen';
    } else if (error instanceof InvitationAddressMismatchError) {
      errorKey.value = 'organizations.acceptInvitation.addressMismatch';
    } else errorKey.value = 'organizations.acceptInvitation.failed';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('organizations.acceptInvitation.title') }}</AppHeading>
      <AppText color="muted">{{ t('organizations.acceptInvitation.subtitle') }}</AppText>
      <AppAlert v-if="errorKey !== ''" variant="error">{{ t(errorKey) }}</AppAlert>
      <AppButton :loading="pending" :disabled="accepted" @click="accept">
        {{ t('organizations.acceptInvitation.accept') }}
      </AppButton>
    </AppStack>
  </AppCard>
</template>
