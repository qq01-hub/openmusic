import 'package:material_ui/material_ui.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/features/web/web_shell_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.init();
  runApp(const OpenMusicWebApp());
}

class OpenMusicWebApp extends StatelessWidget {
  const OpenMusicWebApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'OpenMusic',
      debugShowCheckedModeBanner: false,
      home: WebShellPage(),
    );
  }
}
