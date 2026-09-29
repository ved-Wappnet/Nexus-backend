import { ErrorViewModel } from '@common/vms';
import { ACCESS_TOKEN } from '@core/constants';
import { JwtAuthGuard } from '@core/guards';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from '@domain/auth/dtos';
import { LoginViewModel, UserPublicViewModel } from '@domain/auth/vms';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';

const auth = 'auth';

@ApiTags(auth)
@Controller(auth)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ description: 'User logged in successfully', type: LoginViewModel })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ErrorViewModel })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register as a customer or vendor (name, email, password, accountType)' })
  @ApiOkResponse({ description: 'User registered successfully', type: LoginViewModel })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('forgot')
  @ApiOperation({ summary: 'Request a password reset OTP by email' })
  @ApiOkResponse({ description: 'Reset email dispatched if the account exists' })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgot(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using email OTP' })
  @ApiOkResponse({ description: 'Password updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid or expired OTP', type: ErrorViewModel })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(ACCESS_TOKEN)
  @ApiOperation({ summary: 'Get the current session user' })
  @ApiOkResponse({ description: 'Current user', type: UserPublicViewModel })
  @ApiUnauthorizedResponse({ description: 'Session expired', type: ErrorViewModel })
  me(@Req() req: { user: { userId: string } }) {
    return this.auth.me(req.user.userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(ACCESS_TOKEN)
  @ApiOperation({ summary: 'Logout and record audit log' })
  logout(@Req() req: { user: { userId: string } }) {
    return this.auth.logout(req.user?.userId);
  }
}
