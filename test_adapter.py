import unittest
import server
class ParserTests(unittest.TestCase):
 def test_injury_badge_before_team_does_not_hide_team(self):
  from lxml import html
  node=html.fromstring('<td><div class="ysf-player-name"><a data-ys-playerid="42" title="Test Player">Test Player</a><span class="ysf-player-status Fz-xxs">Q</span><span class="Fz-xxs">NOP - PG,SG</span></div></td>')
  p=server.identity(node);self.assertEqual(p['nba'],'NO');self.assertEqual(p['positions'],['PG','SG']);self.assertEqual(p['injury'],'Q')
 def test_bad_league_id_rejected_before_network(self):
  with self.assertRaises(ValueError):server.refresh('https://other.example')
if __name__=='__main__':unittest.main()
