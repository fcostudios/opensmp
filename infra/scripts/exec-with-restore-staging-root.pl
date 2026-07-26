#!/usr/bin/env perl
use strict;
use warnings;
use Fcntl qw(F_GETFD F_SETFD O_DIRECTORY O_NOFOLLOW O_RDONLY);

@ARGV >= 2 or die "usage: exec-with-restore-staging-root.pl ROOT COMMAND [ARG...]\n";
my $root = shift @ARGV;
$root =~ m{\A/} or die "RESTORE_STAGING_ROOT must be absolute\n";

sysopen(my $root_fh, $root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
  or die "open RESTORE_STAGING_ROOT: $!\n";
my @root_st = stat($root_fh);
@root_st && -d _ && $root_st[4] == $> && ($root_st[2] & 0777) == 0700
  or die "RESTORE_STAGING_ROOT must be a private owned directory\n";

my $root_fd = fileno($root_fh);
my $proc_root = "/proc/self/fd/$root_fd";
-d '/proc/self/fd' or die "RESTORE_STAGING_ROOT mount proof requires procfs\n";
sysopen(my $parent_fh, "$proc_root/..", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
  or die "open RESTORE_STAGING_ROOT parent: $!\n";

sub mount_id {
  my ($fd) = @_;
  open(my $info, '<', "/proc/self/fdinfo/$fd") or die "read fdinfo: $!\n";
  while (my $line = <$info>) {
    return $1 if $line =~ /^mnt_id:\s+([0-9]+)\s*$/;
  }
  die "RESTORE_STAGING_ROOT mount identity is unavailable\n";
}

my $root_mnt = mount_id($root_fd);
my $parent_mnt = mount_id(fileno($parent_fh));
$root_mnt ne $parent_mnt
  or die "RESTORE_STAGING_ROOT must be an explicit mountpoint\n";

if (defined($ENV{RESTORE_TEST_ROOT_READY}) && defined($ENV{RESTORE_TEST_ROOT_RELEASE})) {
  open(my $ready, '>', $ENV{RESTORE_TEST_ROOT_READY})
    or die "create staging-root test marker: $!\n";
  close($ready) or die "close staging-root test marker: $!\n";
  for (1 .. 600) {
    last if -e $ENV{RESTORE_TEST_ROOT_RELEASE};
    select(undef, undef, undef, 0.1);
  }
  -e $ENV{RESTORE_TEST_ROOT_RELEASE}
    or die "staging-root test release timed out\n";
}

fcntl($root_fh, F_SETFD, 0) == 0
  or die "preserve RESTORE_STAGING_ROOT descriptor: $!\n";
$ENV{RESTORE_STAGING_ROOT_FD} = "$root_fd";
$ENV{RESTORE_STAGING_ROOT_ID} = "$root_st[0]|$root_st[1]|$root_mnt";
$ENV{RESTORE_STAGING_ROOT} = $proc_root;
exec @ARGV or die "exec guarded restore: $!\n";
