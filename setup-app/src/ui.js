import { Pressable, StyleSheet, Text } from "react-native";

export function Action({children,onPress,disabled=false,secondary=false}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled}
    onPress={onPress} style={[styles.action,secondary && styles.secondary,disabled && styles.disabled]}>
    <Text style={secondary ? styles.secondaryText : styles.actionText}>{children}</Text>
  </Pressable>;
}

const ink = "#25382c";
const muted = "#506152";
const pine = "#23533d";
export const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:"#f5f3ed",paddingHorizontal:20},
  brand:{color:pine,fontSize:22,fontWeight:"700",paddingTop:12,paddingBottom:16},
  section:{gap:12,paddingBottom:24},
  heading:{fontSize:29,fontWeight:"700",color:ink},
  subheading:{fontSize:17,fontWeight:"700",color:ink},
  copy:{fontSize:16,lineHeight:24,color:muted},
  error:{color:"#8a351e",fontSize:15,lineHeight:22},
  label:{fontSize:15,fontWeight:"600",color:ink},
  input:{borderColor:"#bdc9bd",borderWidth:1,borderRadius:8,minHeight:50,padding:12,
    backgroundColor:"#fffefa",fontSize:17,color:ink},
  action:{padding:13,minHeight:48,borderRadius:8,backgroundColor:pine,alignItems:"center",justifyContent:"center"},
  actionText:{color:"white",fontSize:16,fontWeight:"700",textAlign:"center"},
  secondary:{backgroundColor:"#fffefa",borderWidth:1,borderColor:"#cad4c7"},
  secondaryText:{color:pine,fontSize:16,fontWeight:"600",textAlign:"center"},
  disabled:{opacity:.5},
  choice:{padding:13,minHeight:48,borderWidth:1,borderColor:"#ccd5cb",borderRadius:8,backgroundColor:"#fffefa"},
  selected:{backgroundColor:"#e5efdc",borderColor:pine},
});
