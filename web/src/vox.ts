/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 ******************************************************************************/

import { Aud_Decode } from "./aud";
import { AUDIO_GROUP_SPEECH, Ensure_Audio, Handle_Finished, Play_Pcm, Set_Group_Gain, Stop_Handle, type AudioPlayHandle } from "./audio";
import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { Options } from "./options";
import { TIMER_SECOND } from "./stimer";

export const VOX_NONE = -1;
export const VOX_COUNT = 575;
export const VOX_ACCOMPLISHED = 0;
export const VOX_FAIL = 1;
export const VOX_NO_FACTORY = 2;
export const VOX_CONSTRUCTION = 3;
export const VOX_UNIT_READY = 4;
export const VOX_NEW_CONSTRUCT = 5;
export const VOX_DEPLOY = 6;
export const VOX_STRUCTURE_DESTROYED = 7;
export const VOX_NO_CASH = 8;
export const VOX_CONTROL_EXIT = 9;
export const VOX_REINFORCEMENTS = 10;
export const VOX_CANCELED = 11;
export const VOX_BUILDING = 12;
export const VOX_LOW_POWER = 13;
export const VOX_BASE_UNDER_ATTACK = 14;
export const VOX_PRIMARY_SELECTED = 15;
export const VOX_UNIT_LOST = 16;
export const VOX_SELECT_TARGET = 17;
export const VOX_NEED_MO_CAPACITY = 18;
export const VOX_SUSPENDED = 19;
export const VOX_REPAIRING = 20;
export const VOX_TRAINING = 21;
export const VOX_UPGRADE_ARMOR = 22;
export const VOX_UPGRADE_FIREPOWER = 23;
export const VOX_UPGRADE_SPEED = 24;
export const VOX_UNIT_REPAIRED = 25;
export const VOX_STRUCTURE_SOLD = 26;
export const VOX_HARVESTER_UNDER_ATTACK = 27;
export const VOX_CLOAKED_DETECTED = 28;
export const VOX_SUBTERRANEAN_DETECTED = 29;
export const VOX_TIME_20 = 30;
export const VOX_TIME_10 = 31;
export const VOX_TIME_5 = 32;
export const VOX_TIME_4 = 33;
export const VOX_TIME_3 = 34;
export const VOX_TIME_2 = 35;
export const VOX_TIME_1 = 36;
export const VOX_UNIT_SOLD = 37;
export const VOX_BUILDING_CAPTURED = 38;
export const VOX_CONTROL_ESTABLISHED = 39;
export const VOX_ION_STORM_APPROACHING = 40;
export const VOX_METEOR_STORM = 41;
export const VOX_NEW_TERRAIN = 42;
export const VOX_MISSILE_LAUNCH_DETECTED = 43;
export const VOX_CHEMICAL_MISSILE_READY = 44;
export const VOX_CLUSTER_MISSILE_READY = 45;
export const VOX_ION_CANNON_READY = 46;
export const VOX_EM_PULSE_CANNON_READY = 47;
export const VOX_FIRESTORM_DEFENSE_READY = 48;
export const VOX_FIRESTORM_DEFENSE_OFFLINE = 49;
export const VOX_PRIMARY_OBJECTIVE_ACHIEVED = 50;
export const VOX_SECONDARY_OBJECTIVE_ACHIEVED = 51;
export const VOX_TERTIARY_OBJECTIVE_ACHIEVED = 52;
export const VOX_QUATERNARY_OBJECTIVE_ACHIEVED = 53;
export const VOX_CRITICAL_UNIT_LOST = 54;
export const VOX_CRITICAL_STRUCTURE_LOST = 55;
export const VOX_MUTANT_SUPPLIES_FOUND = 56;
export const VOX_COMMANDOS_EN_ROUTE = 57;
export const VOX_BUILDING_INFILTRATED = 58;
export const VOX_TIMER_STARTED = 59;
export const VOX_TIMER_STOPPED = 60;
export const VOX_BRIDGE_REPAIRED = 61;
export const VOX_BASE_DEFENSES_OFFLINE = 62;
export const VOX_BUILDING_OFFLINE = 63;
export const VOX_BUILDING_ONLINE = 64;
export const VOX_PLAYER_HAS_RESIGNED = 65;
export const VOX_PLAYER_WAS_DEFEATED = 66;
export const VOX_YOU_ARE_VICTORIOUS = 67;
export const VOX_YOU_HAVE_LOST = 68;
export const VOX_YOU_HAVE_RESIGNED = 69;
export const VOX_MUTANT_COMMANDOS_AVAILABLE = 70;
export const VOX_ALLIANCE_FORMED = 71;
export const VOX_ALLIANCE_BROKEN = 72;
export const VOX_ALLY_ATTACK = 73;
export const VOX_TUTORIAL_POWER = 74;
export const VOX_TUTORIAL_BARRACKS = 75;
export const VOX_TUTORIAL_HAND_OF_NOD = 76;
export const VOX_TUTORIAL_REFINERY = 77;
export const VOX_TUTORIAL_SILOS = 78;
export const VOX_GDI_TAUNT_01 = 79;
export const VOX_GDI_TAUNT_02 = 80;
export const VOX_GDI_TAUNT_03 = 81;
export const VOX_GDI_TAUNT_04 = 82;
export const VOX_GDI_TAUNT_05 = 83;
export const VOX_GDI_TAUNT_06 = 84;
export const VOX_GDI_TAUNT_07 = 85;
export const VOX_GDI_TAUNT_08 = 86;
export const VOX_GDI_TAUNT_09 = 87;
export const VOX_GDI_TAUNT_10 = 88;
export const VOX_NOD_TAUNT_01 = 89;
export const VOX_NOD_TAUNT_02 = 90;
export const VOX_NOD_TAUNT_03 = 91;
export const VOX_NOD_TAUNT_04 = 92;
export const VOX_NOD_TAUNT_05 = 93;
export const VOX_NOD_TAUNT_06 = 94;
export const VOX_NOD_TAUNT_07 = 95;
export const VOX_NOD_TAUNT_08 = 96;
export const VOX_NOD_TAUNT_09 = 97;
export const VOX_NOD_TAUNT_10 = 98;
export const VOX_33_N000 = 99;
export const VOX_33_N002 = 100;
export const VOX_33_N004 = 101;
export const VOX_33_N008 = 102;
export const VOX_33_N010 = 103;
export const VOX_33_N012 = 104;
export const VOX_33_N014 = 105;
export const VOX_33_N020 = 106;
export const VOX_33_N022 = 107;
export const VOX_33_N024 = 108;
export const VOX_35_N000 = 109;
export const VOX_35_N002 = 110;
export const VOX_35_N004 = 111;
export const VOX_35_N008 = 112;
export const VOX_35_N010 = 113;
export const VOX_35_N012 = 114;
export const VOX_35_N014 = 115;
export const VOX_40_N000_1 = 116;
export const VOX_00_N000 = 117;
export const VOX_00_N002 = 118;
export const VOX_00_N004 = 119;
export const VOX_00_N006 = 120;
export const VOX_00_N018 = 121;
export const VOX_00_N020 = 122;
export const VOX_00_N022 = 123;
export const VOX_00_N024 = 124;
export const VOX_00_N032 = 125;
export const VOX_00_N034 = 126;
export const VOX_00_N040 = 127;
export const VOX_00_N042 = 128;
export const VOX_00_N044 = 129;
export const VOX_00_N052 = 130;
export const VOX_00_N054 = 131;
export const VOX_00_N055 = 132;
export const VOX_00_N056 = 133;
export const VOX_00_N058 = 134;
export const VOX_00_N059 = 135;
export const VOX_01_N320 = 136;
export const VOX_01_N322 = 137;
export const VOX_01_N324 = 138;
export const VOX_01_N326 = 139;
export const VOX_00_N068 = 140;
export const VOX_00_N070 = 141;
export const VOX_00_N072 = 142;
export const VOX_00_N074 = 143;
export const VOX_00_N075 = 144;
export const VOX_01_N900 = 145;
export const VOX_01_N901 = 146;
export const VOX_00_N084 = 147;
export const VOX_00_N086 = 148;
export const VOX_00_N088 = 149;
export const VOX_00_N090 = 150;
export const VOX_00_N092 = 151;
export const VOX_00_N094 = 152;
export const VOX_00_N096 = 153;
export const VOX_00_N098 = 154;
export const VOX_01_N328 = 155;
export const VOX_01_N330 = 156;
export const VOX_00_N112 = 157;
export const VOX_00_N114 = 158;
export const VOX_00_N128 = 159;
export const VOX_00_N130 = 160;
export const VOX_00_N132 = 161;
export const VOX_00_N134 = 162;
export const VOX_00_N136 = 163;
export const VOX_00_N138 = 164;
export const VOX_00_N140 = 165;
export const VOX_00_N142 = 166;
export const VOX_00_N156 = 167;
export const VOX_00_N158 = 168;
export const VOX_00_N160 = 169;
export const VOX_00_N162 = 170;
export const VOX_00_N166 = 171;
export const VOX_00_N168 = 172;
export const VOX_00_N180 = 173;
export const VOX_00_N182 = 174;
export const VOX_00_N188 = 175;
export const VOX_00_N190 = 176;
export const VOX_00_N192 = 177;
export const VOX_00_N206 = 178;
export const VOX_00_N208 = 179;
export const VOX_00_N210 = 180;
export const VOX_00_N224 = 181;
export const VOX_00_N226 = 182;
export const VOX_00_N228 = 183;
export const VOX_00_N236 = 184;
export const VOX_00_N238 = 185;
export const VOX_00_N240 = 186;
export const VOX_00_N239 = 187;
export const VOX_00_N241 = 188;
export const VOX_00_N243 = 189;
export const VOX_00_N245 = 190;
export const VOX_00_N247 = 191;
export const VOX_00_N248 = 192;
export const VOX_00_N249 = 193;
export const VOX_00_N250 = 194;
export const VOX_00_N251 = 195;
export const VOX_00_N252 = 196;
export const VOX_00_N254 = 197;
export const VOX_00_N255 = 198;
export const VOX_38_N000 = 199;
export const VOX_38_N002 = 200;
export const VOX_38_N006 = 201;
export const VOX_40_N000 = 202;
export const VOX_41_N000 = 203;
export const VOX_41_N002 = 204;
export const VOX_41_N004 = 205;
export const VOX_41_N006 = 206;
export const VOX_43_N000 = 207;
export const VOX_01_N000 = 208;
export const VOX_01_N002 = 209;
export const VOX_01_N004 = 210;
export const VOX_01_N006 = 211;
export const VOX_01_N008 = 212;
export const VOX_01_N010 = 213;
export const VOX_01_N005 = 214;
export const VOX_01_N007 = 215;
export const VOX_01_N009 = 216;
export const VOX_01_N011 = 217;
export const VOX_01_N020 = 218;
export const VOX_01_N022 = 219;
export const VOX_01_N024 = 220;
export const VOX_01_N026 = 221;
export const VOX_01_N027 = 222;
export const VOX_01_N032 = 223;
export const VOX_01_N034 = 224;
export const VOX_01_N036 = 225;
export const VOX_01_N038 = 226;
export const VOX_01_N040 = 227;
export const VOX_01_N054 = 228;
export const VOX_01_N055 = 229;
export const VOX_01_N064 = 230;
export const VOX_01_N066 = 231;
export const VOX_01_N068 = 232;
export const VOX_01_N070 = 233;
export const VOX_01_N072 = 234;
export const VOX_01_N074 = 235;
export const VOX_01_N076 = 236;
export const VOX_01_N086 = 237;
export const VOX_01_N088 = 238;
export const VOX_01_N090 = 239;
export const VOX_01_N100 = 240;
export const VOX_01_N102 = 241;
export const VOX_01_N114 = 242;
export const VOX_01_N116 = 243;
export const VOX_01_N128 = 244;
export const VOX_01_N130 = 245;
export const VOX_01_N132 = 246;
export const VOX_01_N134 = 247;
export const VOX_01_N136 = 248;
export const VOX_01_N144 = 249;
export const VOX_01_N156 = 250;
export const VOX_01_N158 = 251;
export const VOX_01_N160 = 252;
export const VOX_01_N162 = 253;
export const VOX_01_N164 = 254;
export const VOX_01_N174 = 255;
export const VOX_01_N176 = 256;
export const VOX_01_N178 = 257;
export const VOX_01_N180 = 258;
export const VOX_01_N192 = 259;
export const VOX_01_N194 = 260;
export const VOX_01_N196 = 261;
export const VOX_01_N208 = 262;
export const VOX_01_N210 = 263;
export const VOX_01_N212 = 264;
export const VOX_01_N228 = 265;
export const VOX_01_N230 = 266;
export const VOX_01_N232 = 267;
export const VOX_01_N233 = 268;
export const VOX_01_N227 = 269;
export const VOX_01_N229 = 270;
export const VOX_01_N231 = 271;
export const VOX_01_N234 = 272;
export const VOX_01_N256 = 273;
export const VOX_01_N258 = 274;
export const VOX_01_N260 = 275;
export const VOX_01_N262 = 276;
export const VOX_01_N264 = 277;
export const VOX_01_N266 = 278;
export const VOX_01_N268 = 279;
export const VOX_01_N270 = 280;
export const VOX_01_N284 = 281;
export const VOX_01_N286 = 282;
export const VOX_10_N032 = 283;
export const VOX_10_N034 = 284;
export const VOX_10_N036 = 285;
export const VOX_10_N038 = 286;
export const VOX_10_N040 = 287;
export const VOX_10_N042 = 288;
export const VOX_10_N044 = 289;
export const VOX_10_N046 = 290;
export const VOX_44_N000 = 291;
export const VOX_36_N000 = 292;
export const VOX_36_N002 = 293;
export const VOX_36_N004 = 294;
export const VOX_36_N008 = 295;
export const VOX_37_N000 = 296;
export const VOX_37_N002 = 297;
export const VOX_38_N004 = 298;
export const VOX_38_N008 = 299;
export const VOX_38_N010 = 300;
export const VOX_38_N012 = 301;
export const VOX_38_N014 = 302;
export const VOX_38_N016 = 303;
export const VOX_38_N018 = 304;
export const VOX_38_N020 = 305;
export const VOX_38_N022 = 306;
export const VOX_38_N024 = 307;
export const VOX_38_N026 = 308;
export const VOX_38_N028 = 309;
export const VOX_39_N000 = 310;
export const VOX_47_N000 = 311;
export const VOX_INCOMING_TRANSMISSION = 312;
export const VOX_OBJECTIVE_COMPLETE = 313;
export const VOX_FINAL_OBJECTIVE_COMPLETE = 314;
export const VOX_MOBILE_WAR_FACTORY_DEPLOYED = 315;
export const VOX_00_N400 = 316;
export const VOX_00_N402 = 317;
export const VOX_00_N404 = 318;
export const VOX_00_N406 = 319;
export const VOX_00_N408 = 320;
export const VOX_00_N410 = 321;
export const VOX_00_N412 = 322;
export const VOX_00_N414 = 323;
export const VOX_00_N416 = 324;
export const VOX_00_N418 = 325;
export const VOX_00_N420 = 326;
export const VOX_00_N422 = 327;
export const VOX_00_N424 = 328;
export const VOX_00_N426 = 329;
export const VOX_00_N428 = 330;
export const VOX_00_N430 = 331;
export const VOX_00_N432 = 332;
export const VOX_00_N434 = 333;
export const VOX_00_N436 = 334;
export const VOX_00_N438 = 335;
export const VOX_00_N440 = 336;
export const VOX_00_N442 = 337;
export const VOX_00_N444 = 338;
export const VOX_00_N446 = 339;
export const VOX_00_N448 = 340;
export const VOX_00_N450 = 341;
export const VOX_00_N452 = 342;
export const VOX_00_N454 = 343;
export const VOX_00_N456 = 344;
export const VOX_00_N458 = 345;
export const VOX_00_N460 = 346;
export const VOX_00_N462 = 347;
export const VOX_00_N464 = 348;
export const VOX_00_N466 = 349;
export const VOX_00_N468 = 350;
export const VOX_00_N470 = 351;
export const VOX_00_N472 = 352;
export const VOX_00_N474 = 353;
export const VOX_00_N478 = 354;
export const VOX_00_N479 = 355;
export const VOX_00_N480 = 356;
export const VOX_00_N482 = 357;
export const VOX_00_N484 = 358;
export const VOX_00_N486 = 359;
export const VOX_00_N488 = 360;
export const VOX_00_N490 = 361;
export const VOX_00_N492 = 362;
export const VOX_00_N494 = 363;
export const VOX_00_N496 = 364;
export const VOX_00_N498 = 365;
export const VOX_00_N500 = 366;
export const VOX_00_N502 = 367;
export const VOX_00_N504 = 368;
export const VOX_00_N506 = 369;
export const VOX_00_N508 = 370;
export const VOX_00_N510 = 371;
export const VOX_01_N400 = 372;
export const VOX_01_N402 = 373;
export const VOX_01_N404 = 374;
export const VOX_01_N406 = 375;
export const VOX_01_N408 = 376;
export const VOX_01_N410 = 377;
export const VOX_01_N412 = 378;
export const VOX_01_N414 = 379;
export const VOX_01_N416 = 380;
export const VOX_01_N418 = 381;
export const VOX_01_N420 = 382;
export const VOX_01_N422 = 383;
export const VOX_01_N424 = 384;
export const VOX_01_N426 = 385;
export const VOX_01_N428 = 386;
export const VOX_01_N430 = 387;
export const VOX_01_N432 = 388;
export const VOX_01_N434 = 389;
export const VOX_01_N436 = 390;
export const VOX_01_N438 = 391;
export const VOX_01_N440 = 392;
export const VOX_01_N442 = 393;
export const VOX_01_N444 = 394;
export const VOX_01_N446 = 395;
export const VOX_01_N448 = 396;
export const VOX_01_N450 = 397;
export const VOX_01_N452 = 398;
export const VOX_99_N454 = 399;
export const VOX_99_N456 = 400;
export const VOX_99_N458 = 401;
export const VOX_99_N460 = 402;
export const VOX_01_N462 = 403;
export const VOX_99_N464 = 404;
export const VOX_99_N466 = 405;
export const VOX_01_N468 = 406;
export const VOX_01_N470 = 407;
export const VOX_01_N472 = 408;
export const VOX_01_N474 = 409;
export const VOX_01_N476 = 410;
export const VOX_01_N478 = 411;
export const VOX_19_N100 = 412;
export const VOX_19_N102 = 413;
export const VOX_38_N100 = 414;
export const VOX_38_N102 = 415;
export const VOX_38_N104 = 416;
export const VOX_38_N106 = 417;
export const VOX_38_N108 = 418;
export const VOX_38_N110 = 419;
export const VOX_38_N112 = 420;
export const VOX_38_N114 = 421;
export const VOX_38_N116 = 422;
export const VOX_38_N118 = 423;
export const VOX_38_N120 = 424;
export const VOX_38_N122 = 425;
export const VOX_38_N124 = 426;
export const VOX_38_N126 = 427;
export const VOX_38_N128 = 428;
export const VOX_38_N130 = 429;
export const VOX_38_N132 = 430;
export const VOX_38_N134 = 431;
export const VOX_38_N136 = 432;
export const VOX_38_N138 = 433;
export const VOX_38_N140 = 434;
export const VOX_38_N142 = 435;
export const VOX_38_N144 = 436;
export const VOX_38_N146 = 437;
export const VOX_38_N148 = 438;
export const VOX_38_N150 = 439;
export const VOX_38_N152 = 440;
export const VOX_38_N154 = 441;
export const VOX_38_N156 = 442;
export const VOX_52_N000 = 443;
export const VOX_52_N002 = 444;
export const VOX_52_N004 = 445;
export const VOX_54_N000 = 446;
export const VOX_54_N002 = 447;
export const VOX_54_N004 = 448;
export const VOX_54_N006 = 449;
export const VOX_54_N008 = 450;
export const VOX_54_N010 = 451;
export const VOX_54_N012 = 452;
export const VOX_54_N014 = 453;
export const VOX_54_N016 = 454;
export const VOX_54_N018 = 455;
export const VOX_54_N020 = 456;
export const VOX_55_N000 = 457;
export const VOX_55_N002 = 458;
export const VOX_55_N004 = 459;
export const VOX_55_N006 = 460;
export const VOX_55_N008 = 461;
export const VOX_55_N010 = 462;
export const VOX_55_N012 = 463;
export const VOX_55_N014 = 464;
export const VOX_55_N016 = 465;
export const VOX_55_N018 = 466;
export const VOX_55_N020 = 467;
export const VOX_55_N022 = 468;
export const VOX_55_N024 = 469;
export const VOX_55_N026 = 470;
export const VOX_55_N028 = 471;
export const VOX_55_N030 = 472;
export const VOX_55_N032 = 473;
export const VOX_55_N034 = 474;
export const VOX_55_N036 = 475;
export const VOX_55_N038 = 476;
export const VOX_55_N040 = 477;
export const VOX_55_N042 = 478;
export const VOX_55_N044 = 479;
export const VOX_56_N000 = 480;
export const VOX_56_N002 = 481;
export const VOX_56_N004 = 482;
export const VOX_56_N006 = 483;
export const VOX_56_N008 = 484;
export const VOX_56_N010 = 485;
export const VOX_56_N012 = 486;
export const VOX_56_N014 = 487;
export const VOX_56_N016 = 488;
export const VOX_56_N018 = 489;
export const VOX_56_N020 = 490;
export const VOX_57_N100 = 491;
export const VOX_57_N102 = 492;
export const VOX_57_N104 = 493;
export const VOX_57_N106 = 494;
export const VOX_57_N108 = 495;
export const VOX_57_N110 = 496;
export const VOX_57_N112 = 497;
export const VOX_57_N114 = 498;
export const VOX_57_N116 = 499;
export const VOX_57_N118 = 500;
export const VOX_57_N120 = 501;
export const VOX_57_N122 = 502;
export const VOX_57_N124 = 503;
export const VOX_58_N100 = 504;
export const VOX_58_N102 = 505;
export const VOX_58_N104 = 506;
export const VOX_58_N106 = 507;
export const VOX_58_N108 = 508;
export const VOX_58_N110 = 509;
export const VOX_58_N112 = 510;
export const VOX_58_N114 = 511;
export const VOX_58_N116 = 512;
export const VOX_58_N118 = 513;
export const VOX_58_N120 = 514;
export const VOX_58_N122 = 515;
export const VOX_58_N124 = 516;
export const VOX_58_N126 = 517;
export const VOX_58_N128 = 518;
export const VOX_58_N130 = 519;
export const VOX_58_N132 = 520;
export const VOX_58_N134 = 521;
export const VOX_58_N136 = 522;
export const VOX_58_N138 = 523;
export const VOX_58_N140 = 524;
export const VOX_58_N142 = 525;
export const VOX_59_N100 = 526;
export const VOX_59_N102 = 527;
export const VOX_59_N104 = 528;
export const VOX_61_N000 = 529;
export const VOX_61_N002 = 530;
export const VOX_61_N004 = 531;
export const VOX_61_N006 = 532;
export const VOX_61_N008 = 533;
export const VOX_61_N010 = 534;
export const VOX_61_N012 = 535;
export const VOX_22_N100 = 536;
export const VOX_22_N102 = 537;
export const VOX_22_N104 = 538;
export const VOX_22_N106 = 539;
export const VOX_22_N108 = 540;
export const VOX_22_N110 = 541;
export const VOX_22_N112 = 542;
export const VOX_22_N114 = 543;
export const VOX_22_N116 = 544;
export const VOX_22_N118 = 545;
export const VOX_22_N120 = 546;
export const VOX_71_N000 = 547;
export const VOX_71_N100 = 548;
export const VOX_71_N102 = 549;
export const VOX_71_N104 = 550;
export const VOX_71_N106 = 551;
export const VOX_71_N108 = 552;
export const VOX_71_N110 = 553;
export const VOX_71_N112 = 554;
export const VOX_71_N114 = 555;
export const VOX_71_N116 = 556;
export const VOX_71_N118 = 557;
export const VOX_71_N120 = 558;
export const VOX_71_N122 = 559;
export const VOX_71_N124 = 560;
export const VOX_71_N126 = 561;
export const VOX_71_N128 = 562;
export const VOX_71_N130 = 563;
export const VOX_71_N132 = 564;
export const VOX_71_N134 = 565;
export const VOX_71_N136 = 566;
export const VOX_DROP_PODS_READY = 567;
export const VOX_62_N000 = 568;
export const VOX_62_N002 = 569;
export const VOX_62_N004 = 570;
export const VOX_62_N006 = 571;
export const VOX_62_N008 = 572;
export const VOX_62_N010 = 573;
export const VOX_62_N012 = 574;

export const Speech: string[] = [
	"00-I026",
	"00-I028",
	"00-I064",
	"00-I018",
	"00-I076",
	"00-I032",
	"00-I016",
	"00-I008",
	"00-I022",
	"00-I012",
	"00-I038",
	"00-I220",
	"00-I216",
	"00-I024",
	"00-I082",
	"00-I034",
	"00-I074",
	"00-I042",
	"00-I044",
	"00-I218",
	"00-I040",
	"00-I062",
	"00-I068",
	"00-I070",
	"00-I080",
	"00-I078",
	"00-I228",
	"00-I090",
	"00-I172",
	"00-I174",
	"00-I122",
	"00-I124",
	"00-I126",
	"00-I128",
	"00-I130",
	"00-I132",
	"00-I134",
	"00-I226",
	"00-I056",
	"00-I200",
	"00-I176",
	"00-I178",
	"00-I198",
	"00-I150",
	"00-I152",
	"00-I154",
	"00-I156",
	"00-I158",
	"00-I162",
	"00-I170",
	"00-I100",
	"00-I102",
	"00-I104",
	"00-I106",
	"00-I194",
	"00-I196",
	"00-I208",
	"00-I210",
	"00-I014",
	"00-I058",
	"00-I060",
	"00-I118",
	"00-I180",
	"00-I230",
	"00-I232",
	"00-I252",
	"00-I268",
	"00-I284",
	"00-I286",
	"00-I288",
	"00-I290",
	"00-I304",
	"00-I306",
	"00-I308",
	"00-I310",
	"00-I312",
	"00-I314",
	"00-I316",
	"00-I318",
	"00-I344",
	"00-I346",
	"00-I348",
	"00-I352",
	"00-I356",
	"00-I360",
	"00-I370",
	"00-I372",
	"00-I374",
	"00-I376",
	"01-I342",
	"01-I350",
	"01-I352",
	"01-I356",
	"01-I360",
	"01-I362",
	"01-I364",
	"01-I366",
	"01-I368",
	"01-I378",
	"33-N000",
	"33-N002",
	"33-N004",
	"33-N008",
	"33-N010",
	"33-N012",
	"33-N014",
	"33-N020",
	"33-N022",
	"33-N024",
	"35-N000",
	"35-N002",
	"35-N004",
	"35-N008",
	"35-N010",
	"35-N012",
	"35-N014",
	"40-N000",
	"00-N000",
	"00-N002",
	"00-N004",
	"00-N006",
	"00-N018",
	"00-N020",
	"00-N022",
	"00-N024",
	"00-N032",
	"00-N034",
	"00-N040",
	"00-N042",
	"00-N044",
	"00-N052",
	"00-N054",
	"00-N055",
	"00-N056",
	"00-N058",
	"00-N059",
	"01-N320",
	"01-N322",
	"01-N324",
	"01-N326",
	"00-N068",
	"00-N070",
	"00-N072",
	"00-N074",
	"00-N075",
	"01-N900",
	"01-N901",
	"00-N084",
	"00-N086",
	"00-N088",
	"00-N090",
	"00-N092",
	"00-N094",
	"00-N096",
	"00-N098",
	"01-N328",
	"01-N330",
	"00-N112",
	"00-N114",
	"00-N128",
	"00-N130",
	"00-N132",
	"00-N134",
	"00-N136",
	"00-N138",
	"00-N140",
	"00-N142",
	"00-N156",
	"00-N158",
	"00-N160",
	"00-N162",
	"00-N166",
	"00-N168",
	"00-N180",
	"00-N182",
	"00-N188",
	"00-N190",
	"00-N192",
	"00-N206",
	"00-N208",
	"00-N210",
	"00-N224",
	"00-N226",
	"00-N228",
	"00-N236",
	"00-N238",
	"00-N240",
	"00-N239",
	"00-N241",
	"00-N243",
	"00-N245",
	"00-N247",
	"00-N248",
	"00-N249",
	"00-N250",
	"00-N251",
	"00-N252",
	"00-N254",
	"00-N255",
	"38-N000",
	"38-N002",
	"38-N006",
	"40-N000",
	"41-N000",
	"41-N002",
	"41-N004",
	"41-N006",
	"43-N000",
	"01-N000",
	"01-N002",
	"01-N004",
	"01-N006",
	"01-N008",
	"01-N010",
	"01-N005",
	"01-N007",
	"01-N009",
	"01-N011",
	"01-N020",
	"01-N022",
	"01-N024",
	"01-N026",
	"01-N027",
	"01-N032",
	"01-N034",
	"01-N036",
	"01-N038",
	"01-N040",
	"01-N054",
	"01-N055",
	"01-N064",
	"01-N066",
	"01-N068",
	"01-N070",
	"01-N072",
	"01-N074",
	"01-N076",
	"01-N086",
	"01-N088",
	"01-N090",
	"01-N100",
	"01-N102",
	"01-N114",
	"01-N116",
	"01-N128",
	"01-N130",
	"01-N132",
	"01-N134",
	"01-N136",
	"01-N144",
	"01-N156",
	"01-N158",
	"01-N160",
	"01-N162",
	"01-N164",
	"01-N174",
	"01-N176",
	"01-N178",
	"01-N180",
	"01-N192",
	"01-N194",
	"01-N196",
	"01-N208",
	"01-N210",
	"01-N212",
	"01-N228",
	"01-N230",
	"01-N232",
	"01-N233",
	"01-N227",
	"01-N229",
	"01-N231",
	"01-N234",
	"01-N256",
	"01-N258",
	"01-N260",
	"01-N262",
	"01-N264",
	"01-N266",
	"01-N268",
	"01-N270",
	"01-N284",
	"01-N286",
	"10-N032",
	"10-N034",
	"10-N036",
	"10-N038",
	"10-N040",
	"10-N042",
	"10-N044",
	"10-N046",
	"44-N000",
	"36-N000",
	"36-N002",
	"36-N004",
	"36-N008",
	"37-N000",
	"37-N002",
	"38-N004",
	"38-N008",
	"38-N010",
	"38-N012",
	"38-N014",
	"38-N016",
	"38-N018",
	"38-N020",
	"38-N022",
	"38-N024",
	"38-N026",
	"38-N028",
	"39-N000",
	"47-N000",
	"00-I020",
	"00-I500",
	"00-I502",
	"00-I504",
	"00-N400",
	"00-N402",
	"00-N404",
	"00-N406",
	"00-N408",
	"00-N410",
	"00-N412",
	"00-N414",
	"00-N416",
	"00-N418",
	"00-N420",
	"00-N422",
	"00-N424",
	"00-N426",
	"00-N428",
	"00-N430",
	"00-N432",
	"00-N434",
	"00-N436",
	"00-N438",
	"00-N440",
	"00-N442",
	"00-N444",
	"00-N446",
	"00-N448",
	"00-N450",
	"00-N452",
	"00-N454",
	"00-N456",
	"00-N458",
	"00-N460",
	"00-N462",
	"00-N464",
	"00-N466",
	"00-N468",
	"00-N470",
	"00-N472",
	"00-N474",
	"00-N478",
	"00-N479",
	"00-N480",
	"00-N482",
	"00-N484",
	"00-N486",
	"00-N488",
	"00-N490",
	"00-N492",
	"00-N494",
	"00-N496",
	"00-N498",
	"00-N500",
	"00-N502",
	"00-N504",
	"00-N506",
	"00-N508",
	"00-N510",
	"01-N400",
	"01-N402",
	"01-N404",
	"01-N406",
	"01-N408",
	"01-N410",
	"01-N412",
	"01-N414",
	"01-N416",
	"01-N418",
	"01-N420",
	"01-N422",
	"01-N424",
	"01-N426",
	"01-N428",
	"01-N430",
	"01-N432",
	"01-N434",
	"01-N436",
	"01-N438",
	"01-N440",
	"01-N442",
	"01-N444",
	"01-N446",
	"01-N448",
	"01-N450",
	"01-N452",
	"99-N454",
	"99-N456",
	"99-N458",
	"99-N460",
	"01-N462",
	"99-N464",
	"99-N466",
	"01-N468",
	"01-N470",
	"01-N472",
	"01-N474",
	"01-N476",
	"01-N478",
	"19-N100",
	"19-N102",
	"38-N100",
	"38-N102",
	"38-N104",
	"38-N106",
	"38-N108",
	"38-N110",
	"38-N112",
	"38-N114",
	"38-N116",
	"38-N118",
	"38-N120",
	"38-N122",
	"38-N124",
	"38-N126",
	"38-N128",
	"38-N130",
	"38-N132",
	"38-N134",
	"38-N136",
	"38-N138",
	"38-N140",
	"38-N142",
	"38-N144",
	"38-N146",
	"38-N148",
	"38-N150",
	"38-N152",
	"38-N154",
	"38-N156",
	"52-N000",
	"52-N002",
	"52-N004",
	"54-N000",
	"54-N002",
	"54-N004",
	"54-N006",
	"54-N008",
	"54-N010",
	"54-N012",
	"54-N014",
	"54-N016",
	"54-N018",
	"54-N020",
	"55-N000",
	"55-N002",
	"55-N004",
	"55-N006",
	"55-N008",
	"55-N010",
	"55-N012",
	"55-N014",
	"55-N016",
	"55-N018",
	"55-N020",
	"55-N022",
	"55-N024",
	"55-N026",
	"55-N028",
	"55-N030",
	"55-N032",
	"55-N034",
	"55-N036",
	"55-N038",
	"55-N040",
	"55-N042",
	"55-N044",
	"56-N000",
	"56-N002",
	"56-N004",
	"56-N006",
	"56-N008",
	"56-N010",
	"56-N012",
	"56-N014",
	"56-N016",
	"56-N018",
	"56-N020",
	"57-N100",
	"57-N102",
	"57-N104",
	"57-N106",
	"57-N108",
	"57-N110",
	"57-N112",
	"57-N114",
	"57-N116",
	"57-N118",
	"57-N120",
	"57-N122",
	"57-N124",
	"58-N100",
	"58-N102",
	"58-N104",
	"58-N106",
	"58-N108",
	"58-N110",
	"58-N112",
	"58-N114",
	"58-N116",
	"58-N118",
	"58-N120",
	"58-N122",
	"58-N124",
	"58-N126",
	"58-N128",
	"58-N130",
	"58-N132",
	"58-N134",
	"58-N136",
	"58-N138",
	"58-N140",
	"58-N142",
	"59-N100",
	"59-N102",
	"59-N104",
	"61-N000",
	"61-N002",
	"61-N004",
	"61-N006",
	"61-N008",
	"61-N010",
	"61-N012",
	"22-N100",
	"22-N102",
	"22-N104",
	"22-N106",
	"22-N108",
	"22-N110",
	"22-N112",
	"22-N114",
	"22-N116",
	"22-N118",
	"22-N120",
	"71-N000",
	"71-N100",
	"71-N102",
	"71-N104",
	"71-N106",
	"71-N108",
	"71-N110",
	"71-N112",
	"71-N114",
	"71-N116",
	"71-N118",
	"71-N120",
	"71-N122",
	"71-N124",
	"71-N126",
	"71-N128",
	"71-N130",
	"71-N132",
	"71-N134",
	"71-N136",
	"00-I506",
	"62-N000",
	"62-N002",
	"62-N004",
	"62-N006",
	"62-N008",
	"62-N010",
	"62-N012",
];

const SETTLE_TICKS = TIMER_SECOND;
const GAP_TICKS = TIMER_SECOND / 2;
const MAX_PENDING = 8;

let directory: GameDirectory | null = null;
let current: AudioPlayHandle | null = null;
let current_voice = VOX_NONE;
let speak_timer = 0;
let gap_timer = 0;
let speech_enabled = true;
let speak_busy = false;
const queue: number[] = [];

function Is_Critical_Line(voice: number): boolean {
	return voice === VOX_ACCOMPLISHED || voice === VOX_FAIL;
}

function Is_Eva_Line(voice: number): boolean {
	const name = Speech[voice] ?? "";
	return name.startsWith("00-") || name.startsWith("01-");
}

export function Set_Speech_Directory(dir: GameDirectory | null): void {
	directory = dir;
}

export function Set_Speech_Volume(volume: number): void {
	Set_Group_Gain(AUDIO_GROUP_SPEECH, Math.min(255, Math.max(0, volume)) / 255);
}

export function Set_Speech_State(state: boolean): void {
	speech_enabled = state;
}

export function Get_Speech_State(): boolean {
	return speech_enabled;
}

export function Speech_Name(speech: number): string {
	if (speech === VOX_NONE || speech < 0 || speech >= Speech.length) {
		return "none";
	}
	return Speech[speech] ?? "none";
}

export function Stop_Speaking(): void {
	queue.length = 0;
	Stop_Handle(current);
	current = null;
	current_voice = VOX_NONE;
	gap_timer = 0;
}

export function Is_Speaking(): boolean {
	void Speak_AI();
	return !Handle_Finished(current) || queue.length > 0;
}

export function Speak(voice: number, now = false): void {
	if (Options.VoiceVolume <= 0 || voice === VOX_NONE || voice < 0 || voice >= VOX_COUNT) {
		return;
	}
	if (!speech_enabled && Is_Eva_Line(voice)) {
		return;
	}
	if (queue.includes(voice) || current_voice === voice) {
		return;
	}
	const idle = Handle_Finished(current) && queue.length === 0;
	if (now || Is_Critical_Line(voice)) {
		queue.unshift(voice);
		if (queue.length > MAX_PENDING) {
			queue.length = MAX_PENDING;
		}
		if (now) {
			Stop_Handle(current);
			current = null;
			current_voice = VOX_NONE;
		}
	} else {
		if (queue.length >= MAX_PENDING) {
			queue.shift();
		}
		queue.push(voice);
	}
	if (idle) {
		speak_timer = SETTLE_TICKS;
		gap_timer = 0;
	}
	if (now) {
		speak_timer = 0;
	}
	void Speak_AI();
}

export function Speak_Tick(): void {
	if (speak_timer > 0) {
		speak_timer--;
	}
	if (gap_timer > 0) {
		gap_timer--;
	}
	void Speak_AI();
}

export async function Speak_AI(): Promise<void> {
	if (speak_busy) {
		return;
	}
	speak_busy = true;
	try {
		if (!Handle_Finished(current)) {
			return;
		}
		if (current_voice !== VOX_NONE) {
			current_voice = VOX_NONE;
			gap_timer = GAP_TICKS;
		}
		if (queue.length === 0 || speak_timer > 0 || gap_timer > 0) {
			return;
		}
		while (queue.length > 0) {
			const next = queue.shift()!;
			const name = Speech[next];
			if (!name || !directory) {
				continue;
			}
			await Ensure_Audio();
			const packed = await cc_retrieve(directory, `${name}.AUD`);
			const pcm = packed ? Aud_Decode(packed) : null;
			if (!pcm) {
				continue;
			}
			current = Play_Pcm(pcm.samples, pcm.rate, pcm.channels, AUDIO_GROUP_SPEECH, 1, 0, false);
			if (current) {
				current_voice = next;
				return;
			}
		}
	} finally {
		speak_busy = false;
	}
}
