import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CognitoAuthenticationGuard } from '../auth/cognito-authentication.guard.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { WorkforceDirectoryQueryDto } from './dto/workforce-directory-query.dto.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';
import type { WorkforceDirectoryResponse } from './workforce-directory.types.js';

@ApiTags('Workforce administration')
@ApiBearerAuth()
@Controller('v1/admin/workforce-directory')
@UseGuards(CognitoAuthenticationGuard)
export class WorkforceDirectoryController {
  constructor(private readonly directory: WorkforceDirectoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List workforce members inside an authorized practice scope',
  })
  @ApiOkResponse({ description: 'The scoped workforce directory.' })
  @ApiUnauthorizedResponse({ description: 'A valid access token is required.' })
  @ApiForbiddenResponse({
    description: 'The caller cannot manage the requested organization.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Cognito account status is temporarily unavailable.',
  })
  getDirectory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: WorkforceDirectoryQueryDto,
  ): Promise<WorkforceDirectoryResponse> {
    return this.directory.getDirectory(principal, query.organizationId);
  }
}
