import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CognitoAuthenticationGuard } from './cognito-authentication.guard.js';
import { CurrentPrincipal } from './current-principal.decorator.js';
import type { AuthenticatedPrincipal } from './auth.types.js';

interface SessionResponse {
  subject: string;
  tokenUse: 'access';
}

@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('v1/auth')
@UseGuards(CognitoAuthenticationGuard)
export class AuthController {
  @Get('session')
  @ApiOperation({ summary: 'Verify the current Cognito access token' })
  @ApiOkResponse({ description: 'The Cognito access token is valid.' })
  @ApiUnauthorizedResponse({
    description:
      'The token is missing, invalid, expired, or not an access token.',
  })
  session(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): SessionResponse {
    return {
      subject: principal.subject,
      tokenUse: 'access',
    };
  }
}
