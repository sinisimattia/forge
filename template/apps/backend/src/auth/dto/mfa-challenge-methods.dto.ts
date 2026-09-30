import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';
import type { MfaChallengeMethodDto } from './mfa-challenge-response.dto';

/**
 * The request `POST /auth/mfa/methods` takes: a challenge token and nothing else.
 *
 * Nothing in it names an account. The account is the one the challenge row
 * names, for the reason `VerifyMfaDto` gives.
 */
export class MfaChallengeMethodsDto {
  /** The token `POST /auth/login` or the federated redirect handed out. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  challengeToken!: string;
}

/** What `POST /auth/mfa/methods` answers with: the same list a password sign-in carries inline. */
export interface MfaChallengeMethodsResponseDto {
  /** The confirmed methods the challenge may be finished with. */
  methods: MfaChallengeMethodDto[];
}
